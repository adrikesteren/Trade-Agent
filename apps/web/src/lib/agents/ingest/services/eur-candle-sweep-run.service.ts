import { createServiceRoleClient } from "@/lib/supabase/admin";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { barsForIncrementalFetchWindow } from "@/lib/agents/ingest/services/candle-retention.service";
import {
  fetchCandleSyncWindowMeta,
  prepareEurCandleSyncRunWindow,
} from "@/lib/agents/ingest/services/candle-sync-window.service";
import { prepareEurCandleTimestampWindow } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  failSyncRunIfExceededMaxDuration,
  patchSyncRunMetadata,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  resolveLatestRunningBitvavoRunId,
  SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
  SYNC_RUN_TIMED_OUT_REASON,
  type BitvavoSyncTriggerSource,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import {
  syncBitvavoCandlesChunk,
  type CandleSyncMode,
  type SyncCandlesChunkOptions,
} from "@/lib/agents/ingest/services/bitvavo-candles-chunk-sync.service";
import { enqueueSignalsCatalogCloseAfterIncremental } from "@/lib/agents/signal/services/signals-catalog-close-enqueue.service";
import { resolveLatestCatalogCandleCloseIso } from "@/lib/agents/signal/services/latest-catalog-close-for-signals-resolve.service";

export type EurCandleSweepBody = {
  marketOffset?: number;
  timeframe?: string;
  barsPerMarket?: number;
  quote?: string | null;
  marketBatchSize?: number;
  delayMsBetweenMarkets?: number;
  /** Who triggered this sweep (stored on `sync_runs`). */
  triggerSource?: BitvavoSyncTriggerSource;
  /** Same logical run across chunked HTTP calls (from first `beginBitvavoSyncRun`). */
  syncRunId?: string | null;
  /** Carried across continuations together with window or incremental fields. */
  syncMode?: CandleSyncMode;
  candleTimestampId?: string | null;
  targetCloseTimeIso?: string | null;
  windowStartOpen?: string;
  windowEndClose?: string;
  windowBarCount?: number;
};

export type EurCandleSweepResult = {
  ok: true;
  incomplete: boolean;
  chunksProcessed: number;
  candleRowsUpserted: number;
  marketsProcessed: number;
  totalMarkets: number;
  nextMarketOffset: number | null;
  /** Populated for EUR sweeps when a run row exists for this execution. */
  syncRunId: string | null;
  warning?: string;
  emptyWindow?: boolean;
};

type ChunkTiming =
  | {
      syncMode: "full";
      candleTimestampId: null;
      targetCloseTimeIso: null;
    }
  | {
      syncMode: "incremental";
      candleTimestampId: string;
      targetCloseTimeIso: string;
    }
  | {
      syncMode: "window";
      candleTimestampId: null;
      targetCloseTimeIso: null;
      windowStartOpen: string;
      windowEndClose: string;
      windowBarCount: number;
    };

function maxChunksPerRun(): number {
  const n = Number(process.env.BITVAVO_CANDLES_SYNC_MAX_CHUNKS_PER_RUN ?? 8);
  if (!Number.isFinite(n)) return 8;
  return Math.min(Math.max(Math.floor(n), 1), 40);
}

function inlineSweepMaxChunks(): number {
  const n = Number(process.env.BITVAVO_CANDLES_SYNC_INLINE_MAX_CHUNKS ?? 250);
  if (!Number.isFinite(n)) return 250;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

function inlineSweepDeadlineMs(): number {
  const fromEnv = process.env.BITVAVO_CANDLES_SYNC_INLINE_MAX_MS;
  const n = Number(fromEnv);
  if (Number.isFinite(n)) return Math.min(Math.max(n, 10_000), 900_000);
  return process.env.NODE_ENV === "development" ? 900_000 : 300_000;
}

async function resolveChunkTiming(
  admin: ReturnType<typeof createServiceRoleClient>,
  body: EurCandleSweepBody,
  args: {
    isEurQuote: boolean;
    timeframe: string;
    marketOffset: number;
    syncRunId: string | null;
    triggerSource: BitvavoSyncTriggerSource;
  },
): Promise<ChunkTiming> {
  if (body.syncMode === "full") {
    return { syncMode: "full", candleTimestampId: null, targetCloseTimeIso: null };
  }

  const isCatalogTf = args.timeframe === CATALOG_STORAGE_TIMEFRAME;

  // Legacy HTTP continuations: single-bar incremental payload wins over run metadata.
  if (
    body.syncMode === "incremental" &&
    body.candleTimestampId &&
    body.targetCloseTimeIso
  ) {
    const { data: tsHit, error: tsErr } = await admin
      .schema("catalog")
      .from("candle_timestamps")
      .select("id")
      .eq("id", body.candleTimestampId)
      .maybeSingle();
    if (!tsErr && tsHit) {
      return {
        syncMode: "incremental",
        candleTimestampId: body.candleTimestampId,
        targetCloseTimeIso: body.targetCloseTimeIso,
      };
    }
  }

  if (
    body.syncMode === "window" &&
    body.windowStartOpen &&
    body.windowEndClose &&
    body.windowBarCount &&
    body.windowBarCount > 0
  ) {
    return {
      syncMode: "window",
      candleTimestampId: null,
      targetCloseTimeIso: null,
      windowStartOpen: body.windowStartOpen,
      windowEndClose: body.windowEndClose,
      windowBarCount: body.windowBarCount,
    };
  }

  if (args.isEurQuote && isCatalogTf && args.syncRunId) {
    const win = await fetchCandleSyncWindowMeta(admin, args.syncRunId, BITVAVO_SYNC_JOB_CANDLES_EUR);
    if (win) {
      return {
        syncMode: "window",
        candleTimestampId: null,
        targetCloseTimeIso: null,
        windowStartOpen: win.startOpenIso,
        windowEndClose: win.endCloseIso,
        windowBarCount: win.barCount,
      };
    }
  }

  // Fresh EUR sweep at offset 0 (non-window catalog path): DB state wins. Do not trust a stale
  // `body.syncMode === "incremental"` from an old continuation payload before this runs.
  if (args.isEurQuote && isCatalogTf && args.marketOffset === 0) {
    const prep = await prepareEurCandleTimestampWindow(admin, args.timeframe);
    if (prep.mode === "blocked_future_close") {
      if (args.syncRunId) {
        try {
          await recordBitvavoSyncFailed(admin, {
            runId: args.syncRunId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source: args.triggerSource,
            reason: prep.reason,
          });
        } catch {
          /* non-fatal */
        }
      }
      throw new Error(prep.reason);
    }
    if (prep.mode === "incremental") {
      return {
        syncMode: "incremental",
        candleTimestampId: prep.candleTimestampId,
        targetCloseTimeIso: prep.closeTime,
      };
    }
    return { syncMode: "full", candleTimestampId: null, targetCloseTimeIso: null };
  }

  return { syncMode: "full", candleTimestampId: null, targetCloseTimeIso: null };
}

function chunkOptsFromTiming(
  chunkTiming: ChunkTiming,
  base: Pick<
    SyncCandlesChunkOptions,
    "timeframe" | "barsPerMarket" | "quote" | "marketBatchSize" | "delayMsBetweenMarkets"
  >,
): Omit<SyncCandlesChunkOptions, "marketOffset"> {
  if (chunkTiming.syncMode === "window") {
    return {
      ...base,
      syncMode: "window" as const,
      candleTimestampId: null,
      targetCloseTimeIso: null,
      windowStartOpen: chunkTiming.windowStartOpen,
      windowEndClose: chunkTiming.windowEndClose,
      windowBarCount: chunkTiming.windowBarCount,
    };
  }
  if (chunkTiming.syncMode === "incremental") {
    return {
      ...base,
      syncMode: "incremental" as const,
      candleTimestampId: chunkTiming.candleTimestampId,
      targetCloseTimeIso: chunkTiming.targetCloseTimeIso,
      windowStartOpen: undefined,
      windowEndClose: undefined,
      windowBarCount: undefined,
    };
  }
  return {
    ...base,
    syncMode: "full" as const,
    candleTimestampId: null,
    targetCloseTimeIso: null,
    windowStartOpen: undefined,
    windowEndClose: undefined,
    windowBarCount: undefined,
  };
}

/**
 * One EUR candle sweep run (same behaviour as POST /api/workers/bitvavo-candles-sync).
 * Used by the worker route and by local dev auto-sync (instrumentation).
 */
export async function runEurCandleSweep(body: EurCandleSweepBody = {}): Promise<EurCandleSweepResult> {
  const admin = createServiceRoleClient();

  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const fetchWindowCap = barsForIncrementalFetchWindow(timeframe);
  const barsRequested = body.barsPerMarket ?? fetchWindowCap;
  const barsPerMarket = Math.min(Math.max(barsRequested, 1), fetchWindowCap);
  const quote = body.quote === undefined ? "EUR" : body.quote;
  let marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? 25, 1), 80);
  const delayMsBetweenMarkets = Math.min(Math.max(body.delayMsBetweenMarkets ?? 120, 0), 2000);

  const isEurQuote = quote === null || String(quote).toUpperCase() === "EUR";
  const triggerSource = body.triggerSource ?? "automated";
  let syncRunId: string | null = body.syncRunId ?? null;
  if (isEurQuote) {
    try {
      if (marketOffset === 0 && !syncRunId) {
        const begun = await beginBitvavoSyncRun(admin, BITVAVO_SYNC_JOB_CANDLES_EUR, triggerSource);
        if (begun.outcome === "skipped") {
          return {
            ok: true,
            incomplete: false,
            chunksProcessed: 0,
            candleRowsUpserted: 0,
            marketsProcessed: 0,
            totalMarkets: 0,
            nextMarketOffset: null,
            syncRunId: begun.runId,
            warning: SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
          };
        }
        syncRunId = begun.runId;
      } else if (marketOffset > 0 && !syncRunId) {
        syncRunId = await resolveLatestRunningBitvavoRunId(admin, BITVAVO_SYNC_JOB_CANDLES_EUR);
      }
    } catch {
      /* non-fatal */
    }
  }

  if (isEurQuote && syncRunId) {
    const timedOutId = await failSyncRunIfExceededMaxDuration(admin, {
      jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
      runId: syncRunId,
    });
    if (timedOutId) {
      return {
        ok: true,
        incomplete: false,
        chunksProcessed: 0,
        candleRowsUpserted: 0,
        marketsProcessed: 0,
        totalMarkets: 0,
        nextMarketOffset: null,
        syncRunId,
        warning: SYNC_RUN_TIMED_OUT_REASON,
      };
    }
  }

  if (
    isEurQuote &&
    timeframe === CATALOG_STORAGE_TIMEFRAME &&
    marketOffset === 0 &&
    syncRunId &&
    body.syncMode !== "full"
  ) {
    try {
      const prep = await prepareEurCandleSyncRunWindow(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        timeframe,
      });
      if (prep.kind === "empty") {
        try {
          await recordBitvavoSyncCompleted(admin, {
            runId: syncRunId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source: triggerSource,
            metadata: {
              emptyWindow: true,
              candleRowsUpserted: 0,
              chunksProcessed: 0,
              incomplete: false,
            },
          });
        } catch (e) {
          console.error("[eur-candle-sweep] recordBitvavoSyncCompleted (emptyWindow) failed:", e);
        }
        return {
          ok: true,
          incomplete: false,
          chunksProcessed: 0,
          candleRowsUpserted: 0,
          marketsProcessed: 0,
          totalMarkets: 0,
          nextMarketOffset: null,
          syncRunId,
          emptyWindow: true,
        };
      }
    } catch (e) {
      if (syncRunId) {
        try {
          await recordBitvavoSyncFailed(admin, {
            runId: syncRunId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source: triggerSource,
            reason: e instanceof Error ? e.message : "prepare candle window failed",
          });
        } catch {
          /* non-fatal */
        }
      }
      throw e;
    }
  }

  const chunkTiming = await resolveChunkTiming(admin, body, {
    isEurQuote,
    timeframe,
    marketOffset,
    syncRunId,
    triggerSource,
  });

  const maxChunks = maxChunksPerRun();
  let chunksProcessed = 0;
  let candleRowsUpserted = 0;
  let marketsProcessed = 0;
  let lastTotalMarkets = 0;
  let lastResult: Awaited<ReturnType<typeof syncBitvavoCandlesChunk>> | null = null;

  const chunkOptsBase = chunkOptsFromTiming(chunkTiming, {
    timeframe,
    barsPerMarket,
    quote,
    marketBatchSize,
    delayMsBetweenMarkets,
  });

  if (isEurQuote && syncRunId && marketOffset === 0) {
    try {
      const patch: Record<string, unknown> = {
        effectiveCandleSyncMode: chunkTiming.syncMode,
      };
      if (chunkTiming.syncMode === "window") {
        patch.effectiveWindowBarCount = chunkTiming.windowBarCount;
        const large = chunkTiming.windowBarCount > 72;
        if (large) {
          console.warn(
            "[eur-candle-sweep] Large EUR catalog candle window — expect slower Bitvavo/DB work (many bars × all markets).",
            { windowBarCount: chunkTiming.windowBarCount, timeframe, syncRunId },
          );
        }
      } else if (chunkTiming.syncMode === "incremental") {
        patch.incrementalTargetCloseIso = chunkTiming.targetCloseTimeIso;
      } else {
        patch.fullSweepBarsPerMarket = barsPerMarket;
      }
      await patchSyncRunMetadata(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        patch,
      });
    } catch {
      /* non-fatal */
    }
  }

  for (; chunksProcessed < maxChunks; chunksProcessed++) {
    lastResult = await syncBitvavoCandlesChunk(admin, {
      ...chunkOptsBase,
      marketOffset,
    });
    candleRowsUpserted += lastResult.candleRowsUpserted;
    marketsProcessed += lastResult.marketsProcessed;
    lastTotalMarkets = lastResult.totalMarkets;
    if (lastResult.nextMarketOffset == null) {
      break;
    }
    marketOffset = lastResult.nextMarketOffset;
  }

  let incomplete = lastResult != null && lastResult.nextMarketOffset != null;

  if (incomplete) {
    const deadline = Date.now() + inlineSweepDeadlineMs();
    const maxInline = inlineSweepMaxChunks();
    let inlineChunks = 0;
    while (
      lastResult?.nextMarketOffset != null &&
      Date.now() < deadline &&
      inlineChunks < maxInline
    ) {
      marketOffset = lastResult.nextMarketOffset;
      lastResult = await syncBitvavoCandlesChunk(admin, {
        ...chunkOptsBase,
        marketOffset,
      });
      candleRowsUpserted += lastResult.candleRowsUpserted;
      marketsProcessed += lastResult.marketsProcessed;
      lastTotalMarkets = lastResult.totalMarkets;
      chunksProcessed += 1;
      inlineChunks += 1;
    }
    incomplete = lastResult != null && lastResult.nextMarketOffset != null;
  }

  let candleSyncRunMarkedComplete = false;
  if (!incomplete && isEurQuote) {
    try {
      await recordBitvavoSyncCompleted(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: triggerSource,
        metadata: {
          chunksProcessed,
          candleRowsUpserted,
          marketsProcessed,
          totalMarkets: lastTotalMarkets,
          timeframe,
          barsPerMarket,
          incomplete: false,
        },
      });
      candleSyncRunMarkedComplete = true;
    } catch (e) {
      console.error("[eur-candle-sweep] recordBitvavoSyncCompleted failed:", e);
    }

    // Signal pass: candle sync internally picks full / incremental / window; after a successful EUR catalog
    // sweep with new rows we always evaluate the latest closed bar on the global `candle_timestamps` grid.
    if (
      candleSyncRunMarkedComplete &&
      timeframe === CATALOG_STORAGE_TIMEFRAME &&
      candleRowsUpserted > 0
    ) {
      try {
        const signalCloseIso = await resolveLatestCatalogCandleCloseIso(admin);
        if (signalCloseIso) {
          await enqueueSignalsCatalogCloseAfterIncremental({
            closeTimeIso: signalCloseIso,
            timeframe,
            candleSyncRunId: syncRunId,
          });
        }
      } catch (e) {
        console.error("enqueueSignalsCatalogCloseAfterIncremental failed:", e);
      }
    }
  }

  if (incomplete && isEurQuote && syncRunId) {
    try {
      await patchSyncRunMetadata(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        patch: {
          chunksProcessed,
          candleRowsUpserted,
          marketsProcessed,
          totalMarkets: lastTotalMarkets,
          nextMarketOffset: lastResult?.nextMarketOffset ?? marketOffset,
          incomplete: true,
          timeframe,
          barsPerMarket,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  const warning = incomplete
    ? "EUR candle sweep incomplete: inline chunk or time limit reached; run again or raise BITVAVO_CANDLES_SYNC_INLINE_MAX_CHUNKS / BITVAVO_CANDLES_SYNC_INLINE_MAX_MS."
    : undefined;

  // Without this, `automation.sync_runs` stays `running` forever (partial unique blocks new starts).
  if (incomplete && isEurQuote && syncRunId) {
    try {
      await recordBitvavoSyncFailed(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: triggerSource,
        reason: warning ?? "EUR candle sweep incomplete after inline continuation limits.",
        metadata: {
          chunksProcessed,
          candleRowsUpserted,
          marketsProcessed,
          totalMarkets: lastTotalMarkets,
          nextMarketOffset: lastResult?.nextMarketOffset ?? marketOffset,
          incomplete: true,
          timeframe,
          barsPerMarket,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return {
    ok: true,
    incomplete,
    chunksProcessed,
    candleRowsUpserted,
    marketsProcessed,
    totalMarkets: lastTotalMarkets,
    nextMarketOffset: lastResult?.nextMarketOffset ?? null,
    syncRunId: isEurQuote ? syncRunId : null,
    ...(warning ? { warning } : {}),
  };
}
