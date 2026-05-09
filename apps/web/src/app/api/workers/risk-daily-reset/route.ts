import { NextResponse } from "next/server";

import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { runRiskDailyReset } from "@/lib/ops/run-risk-daily-reset";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * POST: QStash signed callback or `Authorization: Bearer CRON_SECRET`.
 * Sets `trading.risk_state.daily_pnl_eur` to 0 for all rows (UTC day boundary when scheduled accordingly).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET, or QStash signing keys + APP_BASE_URL, or ALLOW_INSECURE_QSTASH=1 for local."
        : "Invalid or missing QStash signature or Bearer CRON_SECRET.";
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
