import { NextResponse } from "next/server";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  recordBitvavoSyncFailed,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { runEurCandleSweep, type EurCandleSweepBody } from "@/lib/agents/ingest/services/eur-candle-sweep-run.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

function parseSweepBody(raw: string): EurCandleSweepBody {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as EurCandleSweepBody;
  } catch {
    return {};
  }
}

/**
 * GET: Bearer CRON_SECRET — runs the same EUR candle sweep as POST with an empty JSON body.
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
    const result = await runEurCandleSweep({});
    return NextResponse.json(result);
  } catch (e) {
    try {
      const admin = createServiceRoleClient();
      await recordBitvavoSyncFailed(admin, {
        runId: null,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: "automated",
        reason: e instanceof Error ? e.message : "sync failed",
      });
    } catch {
      /* non-fatal */
    }
    const message = e instanceof Error ? e.message : "sync failed";
    await sendOpsAlert({
      source: "bitvavo-candles-sync",
      level: "error",
      title: "Bitvavo EUR candle sweep failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Bearer CRON_SECRET. Runs the EUR catalog candle sweep inline (full continuation in one process).
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

  const body = parseSweepBody(rawBody);

  try {
    const result = await runEurCandleSweep(body);
    return NextResponse.json(result);
  } catch (e) {
    try {
      const admin = createServiceRoleClient();
      await recordBitvavoSyncFailed(admin, {
        runId: body.syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: body.triggerSource ?? "automated",
        reason: e instanceof Error ? e.message : "sync failed",
      });
    } catch {
      /* non-fatal */
    }
    const message = e instanceof Error ? e.message : "sync failed";
    await sendOpsAlert({
      source: "bitvavo-candles-sync",
      level: "error",
      title: "Bitvavo EUR candle sweep failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
