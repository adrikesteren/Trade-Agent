import { NextResponse } from "next/server";

import { executeFindCoingeckoIdWorker } from "@/lib/agents/ingest/services/coingecko-id-find-worker.service";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

function legacyFindCoingeckoUrl(request: Request): string {
  const from = new URL(request.url);
  const nu = new URL(`${from.origin}/api/workers/assets/find-coingecko-id`);
  nu.searchParams.set("all", "true");
  nu.searchParams.delete("assetCode");
  const source = from.searchParams.get("source");
  if (source) nu.searchParams.set("source", source);
  else nu.searchParams.set("source", "manual");
  return nu.toString();
}

/**
 * GET: Bearer CRON_SECRET — **deprecated**; delegates to `/api/workers/assets/find-coingecko-id?all=true`.
 */
export async function GET(request: Request) {
  const rawBody = "";
  if (!(await verifyScheduledWorker(request, rawBody))) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Use Authorization: Bearer CRON_SECRET." },
      { status: 401 },
    );
  }

  const body = await executeFindCoingeckoIdWorker(legacyFindCoingeckoUrl(request));
  const http =
    body.ok === false && "error" in body && body.error.includes("Provide exactly one")
      ? 400
      : 200;
  return NextResponse.json(body, { status: http });
}

/**
 * POST: Bearer CRON_SECRET — **deprecated**; delegates to `/api/workers/assets/find-coingecko-id?all=true`.
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

  const body = await executeFindCoingeckoIdWorker(legacyFindCoingeckoUrl(request));
  const http =
    body.ok === false && "error" in body && body.error.includes("Provide exactly one")
      ? 400
      : 200;
  return NextResponse.json(body, { status: http });
}
