import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { runBitvavoMarketsEurSyncWithSyncRun } from "@/lib/markets/run-bitvavo-markets-eur-sync-with-sync-run";
import { SKIPPED_PREVIOUS_SYNC_STILL_RUNNING } from "@/lib/markets/record-bitvavo-sync-status";
import { NextResponse } from "next/server";

/**
 * Sync tradable listings from Bitvavo into `exchanges`, `assets`, and `markets` (catalog only).
 * Does not write OHLCV — use candle sync / EUR sweep for `candles`.
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
  if (sourceParam !== "manual") {
    return NextResponse.json(
      {
        error: "markets_sync_manual_only",
        hint: "Open Sync runs → Sync now, or POST with ?source=manual. Automated runs use GET/POST /api/workers/bitvavo-markets-sync with CRON_SECRET.",
      },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  try {
    const result = await runBitvavoMarketsEurSyncWithSyncRun(admin, "manual", {
      quoteFilter: quote === "all" ? null : quote,
    });

    if (result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        syncRunId: result.syncRunId,
        message: SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
      });
    }

    return NextResponse.json({
      ok: true,
      quoteFilter: quote === "all" ? null : quote,
      upsertedListings: result.upsertedListings,
      upsertedAssets: result.upsertedAssets,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
