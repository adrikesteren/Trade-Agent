import { NextResponse } from "next/server";
import { runBitvavoMarketsEurSyncWithSyncRun } from "@/lib/markets/run-bitvavo-markets-eur-sync-with-sync-run";
import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * GET: Bearer CRON_SECRET — same EUR Bitvavo catalog sync as POST.
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
    const result = await runBitvavoMarketsEurSyncWithSyncRun(admin, "automated", { quoteFilter: "EUR" });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    await sendOpsAlert({
      source: "bitvavo-markets-sync",
      level: "error",
      title: "Bitvavo markets EUR sync failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Bearer CRON_SECRET — EUR Bitvavo catalog sync (`sync_runs` job `bitvavo_markets_eur`).
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
    const result = await runBitvavoMarketsEurSyncWithSyncRun(admin, "automated", { quoteFilter: "EUR" });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    await sendOpsAlert({
      source: "bitvavo-markets-sync",
      level: "error",
      title: "Bitvavo markets EUR sync failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
