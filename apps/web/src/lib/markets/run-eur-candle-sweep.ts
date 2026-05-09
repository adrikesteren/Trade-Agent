import { Client } from "@upstash/qstash";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { barsForRetention } from "@/lib/markets/candle-retention";
import { prepareEurCandleTimestampWindow } from "@/lib/markets/prepare-eur-candle-timestamp-window";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  resolveLatestRunningBitvavoRunId,
  type BitvavoSyncTriggerSource,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  syncBitvavoCandlesChunk,
  type CandleSyncMode,
} from "@/lib/markets/sync-bitvavo-candles-chunk";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

export type EurCandleSweepBody = {
  marketOffset?: number;
  timeframe?: string;
  barsPerMarket?: number;
  quote?: string | null;
  marketBatchSize?: number;
  delayMsBetweenMarkets?: number;
  /** Who triggered this sweep (stored on `sync_runs`). */
  triggerSource?: BitvavoSyncTriggerSource;
  /** Same logical run across QStash chunks (from first `beginBitvavoSyncRun`). */
  syncRunId?: string | null;
  /** Carried across QStash continuations together with `candleTimestampId` / `targetCloseTimeIso`. */
  syncMode?: CandleSyncMode;
  candleTimestampId?: string | null;
  targetCloseTimeIso?: string | null;
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
};

type ChunkTiming = {
  syncMode: CandleSyncMode;
  candleTimestampId: string | null;
  targetCloseTimeIso: string | null;
};

function maxChunksPerRun(): number {
  const n = Number(process.env.BITVAVO_CANDLES_SYNC_MAX_CHUNKS_PER_RUN ?? 8);
  if (!Number.isFinite(n)) return 8;
  return Math.min(Math.max(Math.floor(n), 1), 40);
}

/**
 * When true, remaining markets are processed in the same HTTP request (longer, no QStash self-POST chain).
 * `BITVAVO_CANDLES_SYNC_INLINE_CHAIN=1` wins even if QStash is configured — useful in dev to avoid noisy
 * repeated POST /api/workers/bitvavo-candles-sync while still having QSTASH_* set for other features.
 */
function shouldInlineRemainder(canQueueFollowUp: boolean): boolean {
  if (process.env.BITVAVO_CANDLES_SYNC_INLINE_CHAIN === "1") return true;
  if (canQueueFollowUp) return false;
  return process.env.NODE_ENV === "development";
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
  if (
    body.syncMode === "incremental" &&
    body.candleTimestampId &&
    body.targetCloseTimeIso
  ) {
    return {
      syncMode: "incremental",
      candleTimestampId: body.candleTimestampId,
      targetCloseTimeIso: body.targetCloseTimeIso,
    };
  }
  if (body.syncMode === "full") {
    return { syncMode: "full", candleTimestampId: null, targetCloseTimeIso: null };
  }

  if (
    args.isEurQuote &&
    args.timeframe === CATALOG_STORAGE_TIMEFRAME &&
    args.marketOffset === 0
  ) {
    const prep = await prepareEurCandleTimestampWindow(admin, args.timeframe);
    if (prep.mode === "blocked_future_close") {
      if (args.syncRunId) {
        try {
          await recordBitvavoSyncFailed(admin, {
            runId: args.syncRunId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source: args.triggerSource,
            failedReason: prep.reason,
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

/**
 * One EUR candle sweep run (same behaviour as POST /api/workers/bitvavo-candles-sync).
 * Used by the worker route and by local dev auto-sync (instrumentation).
 */
export async function runEurCandleSweep(body: EurCandleSweepBody = {}): Promise<EurCandleSweepResult> {
  const admin = createServiceRoleClient();

  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const retentionCap = barsForRetention(timeframe);
  const barsRequested = body.barsPerMarket ?? retentionCap;
  const barsPerMarket = Math.min(Math.max(barsRequested, 1), retentionCap);
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
        syncRunId = await beginBitvavoSyncRun(
          admin,
          BITVAVO_SYNC_JOB_CANDLES_EUR,
          triggerSource,
        );
      } else if (marketOffset > 0 && !syncRunId) {
        syncRunId = await resolveLatestRunningBitvavoRunId(admin, BITVAVO_SYNC_JOB_CANDLES_EUR);
      }
    } catch {
      /* non-fatal */
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

  const chunkOptsBase = {
    timeframe,
    barsPerMarket,
    quote,
    marketBatchSize,
    delayMsBetweenMarkets,
    syncMode: chunkTiming.syncMode,
    candleTimestampId: chunkTiming.candleTimestampId,
    targetCloseTimeIso: chunkTiming.targetCloseTimeIso,
  };

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
  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  const canQueueFollowUp = Boolean(base && token);

  if (incomplete && shouldInlineRemainder(canQueueFollowUp)) {
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

  if (!incomplete && isEurQuote) {
    try {
      await recordBitvavoSyncCompleted(admin, {
        runId: syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: triggerSource,
      });
    } catch {
      /* non-fatal */
    }
  }

  if (incomplete && canQueueFollowUp) {
    const client = new Client({ token });
    const nextBody: EurCandleSweepBody = {
      marketOffset,
      timeframe,
      quote,
      barsPerMarket,
      marketBatchSize,
      delayMsBetweenMarkets,
      triggerSource,
      syncRunId: syncRunId ?? undefined,
      syncMode: chunkTiming.syncMode,
      candleTimestampId: chunkTiming.candleTimestampId ?? undefined,
      targetCloseTimeIso: chunkTiming.targetCloseTimeIso ?? undefined,
    };
    await client.publishJSON({
      url: `${base}/api/workers/bitvavo-candles-sync`,
      body: nextBody,
      retries: 3,
    });
  }

  const warning =
    incomplete && !canQueueFollowUp && !shouldInlineRemainder(canQueueFollowUp)
      ? "Sweep not finished: set APP_BASE_URL and QSTASH_TOKEN, or BITVAVO_CANDLES_SYNC_INLINE_CHAIN=1 for a long single request."
      : incomplete && !canQueueFollowUp && shouldInlineRemainder(canQueueFollowUp)
        ? "Sweep stopped: inline time/chunk limit reached; run again or use QStash + APP_BASE_URL."
        : undefined;

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
