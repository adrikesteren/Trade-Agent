import { NextResponse } from "next/server";

import {
  rebuildRegimeClassifierAcrossMarkets,
  rebuildRegimeClassifierForMarket,
} from "@/lib/agents/signal/services/regime-classifier-rebuild.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * Focused, fast rebuild of `regime-classifier-15m-v1` signals.
 *
 * Bulk-upserts in chunks of 500 instead of the per-bar HTTP roundtrip used by the
 * generic evaluate-all worker — typically completes in tens of seconds for a 17 000-
 * candle market vs many hours.
 *
 * Optional query params:
 *   - `marketId=<uuid>`   — restrict to one market (omit to loop every market with candles)
 *
 * The signal upsert key is `(user_id, signal_agent_id, candle_id)` so existing rows are
 * overwritten in place (signal id preserved → downstream FK references survive).
 */
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

  try {
    const admin = createServiceRoleClient();
    if (marketId) {
      const result = await rebuildRegimeClassifierForMarket(admin, { marketId });
      return NextResponse.json(result);
    }
    const result = await rebuildRegimeClassifierAcrossMarkets(admin);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "regime classifier rebuild failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request, "");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
