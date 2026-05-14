import { NextResponse } from "next/server";

import { runMarketBackfillCandles } from "@/lib/orchestrators/market-backfill-candles.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const url = new URL(request.url);
  const marketId = url.searchParams.get("marketId")?.trim() ?? "";
  const startDate = url.searchParams.get("startDate")?.trim() ?? "";
  const endDateRaw = url.searchParams.get("endDate")?.trim() ?? "";
  const endDate = endDateRaw || null;

  if (!marketId || !startDate) {
    return NextResponse.json(
      { error: "invalid_query", hint: "Required: ?marketId=<uuid>&startDate=<YYYY-MM-DD> (optional: &endDate=<YYYY-MM-DD>)" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  try {
    const result = await runMarketBackfillCandles(admin, { marketId, startDate, endDate });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "market backfill candles failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; query `marketId`, `startDate`, optional `endDate`. */
export async function GET(request: Request) {
  return handle(request, "");
}

/** POST: Bearer CRON_SECRET; query `marketId`, `startDate`, optional `endDate`. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
