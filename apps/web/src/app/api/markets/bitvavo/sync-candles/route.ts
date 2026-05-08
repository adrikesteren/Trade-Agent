import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { barsForRetention, CANDLE_RETENTION_HOURS } from "@/lib/markets/candle-retention";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  type BitvavoSyncTriggerSource,
  recordBitvavoSyncSuccess,
} from "@/lib/markets/record-bitvavo-sync-status";
import { syncBitvavoCandlesChunk } from "@/lib/markets/sync-bitvavo-candles-chunk";
import { NextResponse } from "next/server";

type Body = {
  timeframe?: string;
  barsPerMarket?: number;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  delayMsBetweenMarkets?: number;
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

  const timeframe = body.timeframe ?? "5m";
  const retentionCap = barsForRetention(timeframe);
  const barsRequested = body.barsPerMarket ?? retentionCap;
  const barsPerMarket = Math.min(Math.max(barsRequested, 1), retentionCap);
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? 25, 1), 80);
  const delayMsBetweenMarkets = Math.min(Math.max(body.delayMsBetweenMarkets ?? 120, 0), 2000);

  const admin = createServiceRoleClient();

  try {
    const result = await syncBitvavoCandlesChunk(admin, {
      timeframe,
      barsPerMarket,
      quote,
      marketOffset,
      marketBatchSize,
      delayMsBetweenMarkets,
    });

    const isFullSweepDone = result.nextMarketOffset == null;
    const isEurQuote = quote === null || String(quote).toUpperCase() === "EUR";
    if (isFullSweepDone && isEurQuote) {
      try {
        await recordBitvavoSyncSuccess(admin, BITVAVO_SYNC_JOB_CANDLES_EUR, source);
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
      planningNotes: {
        approxBytesPerRowAssumed: approxBytesPerRow,
        approxMbThisChunk: Math.round(approxMbStored * 1000) / 1000,
        retentionHours: CANDLE_RETENTION_HOURS,
        retentionMaxBars: result.retentionMaxBars,
        hint: `Bars are capped to the retention window (${CANDLE_RETENTION_HOURS}h); old rows are deleted after each chunk.`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
