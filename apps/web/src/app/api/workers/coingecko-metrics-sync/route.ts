import { NextResponse } from "next/server";
import {
  runCoingeckoMetricsSyncWithSyncRun,
  type CoingeckoMetricsSyncBody,
} from "@/lib/markets/run-coingecko-sync-with-sync-run";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * GET: Bearer CRON_SECRET — same CoinGecko metrics sync as POST with an empty body.
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
    const result = await runCoingeckoMetricsSyncWithSyncRun(admin, "automated", {});
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Bearer CRON_SECRET. Runs sync inline.
 * Body optional: `{ "syncRunId": "<uuid>" }` to attach to an existing run (legacy payloads only).
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

  const body: CoingeckoMetricsSyncBody = {};
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as { syncRunId?: string | null };
      if (typeof parsed?.syncRunId === "string" || parsed?.syncRunId === null) {
        body.syncRunId = parsed.syncRunId;
      }
    } catch {
      /* ignore invalid JSON; treat as empty body */
    }
  }

  try {
    const admin = createServiceRoleClient();
    const result = await runCoingeckoMetricsSyncWithSyncRun(admin, "automated", body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
