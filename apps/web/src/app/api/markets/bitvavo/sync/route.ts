import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  type BitvavoSyncTriggerSource,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
} from "@/lib/markets/record-bitvavo-sync-status";
import { syncBitvavoMarkets } from "@/lib/markets/sync-bitvavo-markets";
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
        hint: "EUR market catalog sync is manual-only. Open Assets → Sync Now, or POST with ?source=manual.",
      },
      { status: 400 },
    );
  }
  const source: BitvavoSyncTriggerSource = "manual";

  const admin = createServiceRoleClient();
  let marketsRunId: string | null = null;
  try {
    if (quote === "EUR") {
      try {
        marketsRunId = await beginBitvavoSyncRun(admin, BITVAVO_SYNC_JOB_MARKETS_EUR, source);
      } catch {
        /* non-fatal */
      }
    }
    const stats = await syncBitvavoMarkets(admin, quote === "all" ? null : quote);
    if (quote === "EUR" && marketsRunId) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId: marketsRunId,
          jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
          source,
        });
      } catch {
        /* non-fatal: sync data is already persisted */
      }
    }
    return NextResponse.json({
      ok: true,
      quoteFilter: quote === "all" ? null : quote,
      ...stats,
    });
  } catch (e) {
    if (quote === "EUR" && marketsRunId) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId: marketsRunId,
          jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
          source,
        });
      } catch {
        /* non-fatal */
      }
    }
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
