import { Client } from "@upstash/qstash";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { barsForRetention } from "@/lib/markets/candle-retention";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  recordBitvavoSyncSuccess,
} from "@/lib/markets/record-bitvavo-sync-status";
import { syncBitvavoCandlesChunk } from "@/lib/markets/sync-bitvavo-candles-chunk";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

type SweepBody = {
  marketOffset?: number;
  timeframe?: string;
  barsPerMarket?: number;
  quote?: string | null;
  marketBatchSize?: number;
  delayMsBetweenMarkets?: number;
};

function parseSweepBody(raw: string): SweepBody {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as SweepBody;
  } catch {
    return {};
  }
}

function maxChunksPerRun(): number {
  const n = Number(process.env.BITVAVO_CANDLES_SYNC_MAX_CHUNKS_PER_RUN ?? 8);
  if (!Number.isFinite(n)) return 8;
  return Math.min(Math.max(Math.floor(n), 1), 40);
}

/**
 * GET: Vercel Cron (Bearer CRON_SECRET). Enqueues a QStash POST to this same path — required so
 * multi-chunk sweeps can chain without restarting at offset 0 every cron tick.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (!base || !token) {
    return NextResponse.json(
      {
        error: "missing_config",
        hint: "Set APP_BASE_URL (or NEXT_PUBLIC_APP_URL) and QSTASH_TOKEN so the cron can enqueue a signed POST to run the EUR candle sweep.",
      },
      { status: 501 },
    );
  }

  const client = new Client({ token });
  await client.publishJSON({
    url: `${base}/api/workers/bitvavo-candles-sync`,
    body: {},
    retries: 3,
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * POST: QStash (signed) or manual trigger with Bearer CRON_SECRET. Runs up to N candle chunks,
 * then queues the next chunk via QStash until the full EUR sweep completes; then updates
 * `bitvavo_sync_status` for `bitvavo_candles_eur`.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = parseSweepBody(rawBody);
  const admin = createServiceRoleClient();

  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const retentionCap = barsForRetention(timeframe);
  const barsRequested = body.barsPerMarket ?? retentionCap;
  const barsPerMarket = Math.min(Math.max(barsRequested, 1), retentionCap);
  const quote = body.quote === undefined ? "EUR" : body.quote;
  let marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? 25, 1), 80);
  const delayMsBetweenMarkets = Math.min(Math.max(body.delayMsBetweenMarkets ?? 120, 0), 2000);

  const maxChunks = maxChunksPerRun();
  let chunksProcessed = 0;
  let candleRowsUpserted = 0;
  let marketsProcessed = 0;
  let lastTotalMarkets = 0;
  let lastResult: Awaited<ReturnType<typeof syncBitvavoCandlesChunk>> | null = null;

  try {
    for (; chunksProcessed < maxChunks; chunksProcessed++) {
      lastResult = await syncBitvavoCandlesChunk(admin, {
        timeframe,
        barsPerMarket,
        quote,
        marketOffset,
        marketBatchSize,
        delayMsBetweenMarkets,
      });
      candleRowsUpserted += lastResult.candleRowsUpserted;
      marketsProcessed += lastResult.marketsProcessed;
      lastTotalMarkets = lastResult.totalMarkets;
      if (lastResult.nextMarketOffset == null) {
        break;
      }
      marketOffset = lastResult.nextMarketOffset;
    }

    const incomplete = lastResult != null && lastResult.nextMarketOffset != null;
    const isEurQuote = quote === null || String(quote).toUpperCase() === "EUR";

    if (!incomplete && isEurQuote) {
      try {
        await recordBitvavoSyncSuccess(admin, BITVAVO_SYNC_JOB_CANDLES_EUR, "automated");
      } catch {
        /* non-fatal */
      }
    }

    const base = workerPublicBaseUrl();
    const token = process.env.QSTASH_TOKEN;

    if (incomplete && base && token) {
      const client = new Client({ token });
      const nextBody: SweepBody = {
        marketOffset,
        timeframe,
        quote,
        barsPerMarket,
        marketBatchSize,
        delayMsBetweenMarkets,
      };
      await client.publishJSON({
        url: `${base}/api/workers/bitvavo-candles-sync`,
        body: nextBody,
        retries: 3,
      });
    }

    return NextResponse.json({
      ok: true,
      incomplete,
      chunksProcessed,
      candleRowsUpserted,
      marketsProcessed,
      totalMarkets: lastTotalMarkets,
      nextMarketOffset: lastResult?.nextMarketOffset ?? null,
      warning:
        incomplete && (!base || !token)
          ? "Sweep not finished: set APP_BASE_URL and QSTASH_TOKEN so remaining chunks can be queued."
          : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
