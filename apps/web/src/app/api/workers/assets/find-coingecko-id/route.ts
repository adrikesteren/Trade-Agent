import { NextResponse } from "next/server";

import { executeFindCoingeckoIdWorker } from "@/lib/markets/execute-find-coingecko-id-worker";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * GET: Bearer CRON_SECRET — per-asset (`?assetCode=`) or orchestrator (`?all=true`).
 */
export async function GET(request: Request) {
  if (!(await verifyScheduledWorker(request, ""))) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Use Authorization: Bearer CRON_SECRET." },
      { status: 401 },
    );
  }

  const body = await executeFindCoingeckoIdWorker(request.url);
  const http =
    body.ok === false && "error" in body && body.error.includes("Provide exactly one")
      ? 400
      : 200;
  return NextResponse.json(body, { status: http });
}

/**
 * POST: Bearer CRON_SECRET — same as GET.
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

  const body = await executeFindCoingeckoIdWorker(request.url);
  const http =
    body.ok === false && "error" in body && body.error.includes("Provide exactly one")
      ? 400
      : 200;
  return NextResponse.json(body, { status: http });
}
