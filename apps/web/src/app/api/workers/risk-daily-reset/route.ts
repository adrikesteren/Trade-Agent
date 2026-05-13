import { NextResponse } from "next/server";

import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { runRiskDailyReset } from "@/lib/ops/run-risk-daily-reset";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * POST: `Authorization: Bearer CRON_SECRET`.
 * Sets `trading.executors.risk_daily_pnl_eur` to 0 for all rows (UTC day boundary when scheduled accordingly).
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
    const result = await runRiskDailyReset();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "risk daily reset failed";
    await sendOpsAlert({
      source: "risk-daily-reset",
      level: "error",
      title: "Risk daily reset failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
