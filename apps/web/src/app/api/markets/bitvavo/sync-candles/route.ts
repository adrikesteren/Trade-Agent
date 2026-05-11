import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  barsForRetention,
  CANDLE_RETENTION_HOURS,
  CANDLE_TIMESTAMP_TTL_HOURS,
  CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS,
} from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  fetchCandleSyncWindowMeta,
  prepareEurCandleSyncRunWindow,
} from "@/lib/markets/candle-sync-window";
import { prepareEurCandleTimestampWindow } from "@/lib/markets/prepare-eur-candle-timestamp-window";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  type BitvavoSyncTriggerSource,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  resolveLatestRunningBitvavoRunId,
  SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  syncBitvavoCandlesChunk,
  type CandleSyncMode,
} from "@/lib/markets/sync-bitvavo-candles-chunk";
import { NextResponse } from "next/server";

type Body = {
  timeframe?: string;
  barsPerMarket?: number;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  delayMsBetweenMarkets?: number;
  /** Same logical EUR sweep across chunked POSTs. */
  syncRunId?: string | null;
  syncMode?: CandleSyncMode;
  candleTimestampId?: string | null;
  targetCloseTimeIso?: string | null;
  windowStartOpen?: string;
  windowEndClose?: string;
  windowBarCount?: number;
};

/**
 * Sync OHLCV for a **batch** of markets. Repeat with increasing `marketOffset` until `nextMarketOffset` is null.
 * Heavy: one Bitvavo request per market in the batch.
 */
export async function POST(request: Request) {
  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");
  const source: BitvavoSyncTriggerSource = sourceParam === "manual" ? "manual" : "automated";

  let body: Body = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const timeframe = body.timeframe ?? "15m";
  const retentionCap = barsForRetention(timeframe);
  const barsRequested = body.barsPerMarket ?? retentionCap;
  const barsPerMarket = Math.min(Math.max(barsRequested, 1), retentionCap);
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? 25, 1), 80);
  const delayMsBetweenMarkets = Math.min(Math.max(body.delayMsBetweenMarkets ?? 120, 0), 2000);
  const isEurQuote = quote === null || String(quote).toUpperCase() === "EUR";
  const isCatalogTf = timeframe === CATALOG_STORAGE_TIMEFRAME;

  const admin = createServiceRoleClient();
  let runId: string | null = body.syncRunId ?? null;

  if (isEurQuote) {
    if (marketOffset === 0 && !runId) {
      try {
        const begun = await beginBitvavoSyncRun(admin, BITVAVO_SYNC_JOB_CANDLES_EUR, source);
        if (begun.outcome === "skipped") {
          return NextResponse.json({
            ok: true,
            skipped: true,
            syncRunId: begun.runId,
            message: SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
          });
        }
        runId = begun.runId;
      } catch {
        /* non-fatal */
      }
    } else if (marketOffset > 0 && !runId) {
      try {
        runId = await resolveLatestRunningBitvavoRunId(admin, BITVAVO_SYNC_JOB_CANDLES_EUR);
      } catch {
        /* non-fatal */
      }
    }
  }

  let syncMode: CandleSyncMode = "full";
  let candleTimestampId: string | null = null;
  let targetCloseTimeIso: string | null = null;
  let windowStartOpen: string | undefined;
  let windowEndClose: string | undefined;
  let windowBarCount: number | undefined;

  if (body.syncMode === "full") {
    syncMode = "full";
  } else if (isEurQuote && isCatalogTf && runId) {
    if (marketOffset === 0) {
      const prep = await prepareEurCandleSyncRunWindow(admin, {
        runId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        timeframe,
      });
      if (prep.kind === "empty") {
        try {
          await recordBitvavoSyncCompleted(admin, {
            runId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source,
            metadata: { emptyWindow: true, candleRowsUpserted: 0 },
          });
        } catch {
          /* non-fatal */
        }
        return NextResponse.json({
          ok: true,
          emptyWindow: true,
          syncRunId: runId,
          marketsProcessed: 0,
          candleRowsUpserted: 0,
          nextMarketOffset: null,
          totalMarkets: 0,
          timeframe,
          barsPerMarket: 0,
          retentionMaxBars: retentionCap,
          syncMode: "window",
        });
      }
      syncMode = "window";
      windowStartOpen = prep.startOpenIso;
      windowEndClose = prep.endCloseIso;
      windowBarCount = prep.barCount;
    } else {
      const fromPayload =
        body.syncMode === "window" &&
        body.windowStartOpen &&
        body.windowEndClose &&
        body.windowBarCount &&
        body.windowBarCount > 0
          ? {
              startOpenIso: body.windowStartOpen,
              endCloseIso: body.windowEndClose,
              barCount: body.windowBarCount,
            }
          : null;

      const win = fromPayload ?? (await fetchCandleSyncWindowMeta(admin, runId, BITVAVO_SYNC_JOB_CANDLES_EUR));
      if (win) {
        syncMode = "window";
        windowStartOpen = win.startOpenIso;
        windowEndClose = win.endCloseIso;
        windowBarCount = win.barCount;
      } else if (
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
          syncMode = "incremental";
          candleTimestampId = body.candleTimestampId;
          targetCloseTimeIso = body.targetCloseTimeIso;
        }
      }
    }
  } else if (isEurQuote && isCatalogTf && marketOffset === 0) {
    const prep = await prepareEurCandleTimestampWindow(admin, timeframe);
    if (prep.mode === "blocked_future_close") {
      if (runId) {
        try {
          await recordBitvavoSyncFailed(admin, {
            runId,
            jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
            source,
            reason: prep.reason,
          });
        } catch {
          /* non-fatal */
        }
      }
      return NextResponse.json({ error: prep.reason }, { status: 400 });
    }
    if (prep.mode === "incremental") {
      syncMode = "incremental";
      candleTimestampId = prep.candleTimestampId;
      targetCloseTimeIso = prep.closeTime;
    }
  } else if (
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
      syncMode = "incremental";
      candleTimestampId = body.candleTimestampId;
      targetCloseTimeIso = body.targetCloseTimeIso;
    }
  }

  try {
    const result = await syncBitvavoCandlesChunk(admin, {
      timeframe,
      barsPerMarket,
      quote,
      marketOffset,
      marketBatchSize,
      delayMsBetweenMarkets,
      syncMode,
      candleTimestampId,
      targetCloseTimeIso,
      windowStartOpen,
      windowEndClose,
      windowBarCount,
    });

    const isFullSweepDone = result.nextMarketOffset == null;
    if (isFullSweepDone && isEurQuote) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
          source,
        });
      } catch {
        /* non-fatal */
      }
    }

    /** Rough planning number: ~400–900 bytes per row including indexes (order of magnitude). */
    const approxBytesPerRow = 700;
    const approxMbStored = (result.candleRowsUpserted * approxBytesPerRow) / (1024 * 1024);

    return NextResponse.json({
      ok: true,
      ...result,
      syncRunId: runId,
      planningNotes: {
        approxBytesPerRowAssumed: approxBytesPerRow,
        approxMbThisChunk: Math.round(approxMbStored * 1000) / 1000,
        retentionHoursForBarCap: CANDLE_RETENTION_HOURS,
        initialEmptySyncHistoryHours: CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS,
        candleTimestampTtlHours: CANDLE_TIMESTAMP_TTL_HOURS,
        retentionMaxBars: result.retentionMaxBars,
        hint:
          `Non-window / incremental bar counts use CANDLE_RETENTION_HOURS (${CANDLE_RETENTION_HOURS}h). ` +
          `First EUR prepare when candle_timestamps is empty uses ${CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS}h (~480 x 15m bars). ` +
          `After each chunk, timestamps older than ${CANDLE_TIMESTAMP_TTL_HOURS}h (~365d) are deleted (candles cascade).`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    if (isEurQuote) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
          source,
          reason: message,
        });
      } catch {
        /* non-fatal */
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
