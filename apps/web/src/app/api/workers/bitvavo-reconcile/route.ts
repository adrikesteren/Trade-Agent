import { NextResponse } from "next/server";

import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { runBitvavoReconcile } from "@/lib/ops/run-bitvavo-reconcile";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * POST: `Authorization: Bearer CRON_SECRET`.
 * Syncs non-terminal live Bitvavo orders with the exchange (Redis lock when configured).
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
    const result = await runBitvavoReconcile();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "reconcile failed";
    await sendOpsAlert({
      source: "bitvavo-reconcile",
      level: "error",
      title: "Bitvavo reconcile failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
