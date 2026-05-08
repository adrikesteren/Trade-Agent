import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  type BitvavoSyncTriggerSource,
  recordBitvavoSyncSuccess,
} from "@/lib/markets/record-bitvavo-sync-status";
import { backfillMissingBitvavoCandles } from "@/lib/markets/backfill-missing-bitvavo-candles";
import { syncBitvavoMarkets } from "@/lib/markets/sync-bitvavo-markets";
import { NextResponse } from "next/server";

function marketSyncBackfillMax(): number {
  const raw = process.env.BITVAVO_MARKET_SYNC_BACKFILL_MAX_MARKETS;
  if (raw === undefined || raw === "") return 25;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 25;
  return Math.min(Math.floor(n), 200);
}

/**
 * Sync tradable listings from Bitvavo into `assets` + `exchange_assets`.
 * Requires logged-in user; uses service role for bulk upsert (catalog is global).
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
  const quote = url.searchParams.get("quote") ?? "EUR";
  const sourceParam = url.searchParams.get("source");
  const source: BitvavoSyncTriggerSource = sourceParam === "manual" ? "manual" : "automated";

  const admin = createServiceRoleClient();
  try {
    const stats = await syncBitvavoMarkets(admin, quote === "all" ? null : quote);
    let candlesBackfill: Awaited<ReturnType<typeof backfillMissingBitvavoCandles>> | null = null;
    if (quote === "EUR") {
      try {
        await recordBitvavoSyncSuccess(admin, BITVAVO_SYNC_JOB_MARKETS_EUR, source);
      } catch {
        /* non-fatal: sync data is already persisted */
      }
      const max = marketSyncBackfillMax();
      if (max > 0) {
        try {
          candlesBackfill = await backfillMissingBitvavoCandles(admin, {
            quote: "EUR",
            maxMarkets: max,
            delayMsBetweenMarkets: 120,
          });
        } catch (e) {
          candlesBackfill = {
            error: e instanceof Error ? e.message : "candles_backfill_failed",
            seededMarkets: 0,
            candleRowsUpserted: 0,
            missingTotal: 0,
          };
        }
      }
    }
    return NextResponse.json({
      ok: true,
      quoteFilter: quote === "all" ? null : quote,
      ...stats,
      candlesBackfill,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
