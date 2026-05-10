import { NextResponse } from "next/server";
import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * GET: Bearer CRON_SECRET — same CoinGecko coin-id sync as POST.
 */
export async function GET(request: Request) {
  const rawBody = "";
  if (!(await verifyScheduledWorker(request, rawBody))) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Use Authorization: Bearer CRON_SECRET." },
      { status: 401 },
    );
  }

  try {
    const admin = createServiceRoleClient();
    const result = await runCoingeckoCoinIdSyncWithSyncRun(admin, "automated");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Bearer CRON_SECRET — fills `assets.coingecko_coin_id` when empty.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  try {
    const admin = createServiceRoleClient();
    const result = await runCoingeckoCoinIdSyncWithSyncRun(admin, "automated");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
