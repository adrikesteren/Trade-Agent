import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run";
import { NextResponse } from "next/server";

/**
 * Manual trigger: fills `assets.coingecko_coin_id` from metadata or CoinGecko /search. Requires logged-in user.
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
  if (url.searchParams.get("source") !== "manual") {
    return NextResponse.json(
      {
        error: "coingecko_coin_id_manual_only",
        hint: "POST with ?source=manual from Sync runs, or use GET/POST /api/workers/coingecko-coin-id-sync with CRON_SECRET.",
      },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  try {
    const result = await runCoingeckoCoinIdSyncWithSyncRun(admin, "manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
