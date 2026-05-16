import { NextResponse } from "next/server";

import { executeMarketEvaluateAllSignalsWithSyncRun } from "@/lib/agents/signal/services/market-evaluate-all-signals-with-sync-run.service";
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

  if (!marketId) {
    return NextResponse.json(
      { error: "invalid_query", hint: "Required: ?marketId=<uuid>" },
      { status: 400 },
    );
  }

  // Optional `?forceAgentSlugs=slug1,slug2` — comma-separated list of agent slugs whose
  // existing signals should be overwritten instead of skipped. Used after seed config
  // changes (e.g. regime classifier going from daily → 4h SMA(200)).
  const forceAgentSlugs = (url.searchParams.get("forceAgentSlugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Optional close-time slice (ISO 8601). Used by the chunked Relay publisher so the
  // worker only processes a sub-window of the market's history per Relay message.
  const closeTimeGteIso = url.searchParams.get("closeTimeGteIso")?.trim() || null;
  const closeTimeLteIso = url.searchParams.get("closeTimeLteIso")?.trim() || null;

  try {
    const outcome = await executeMarketEvaluateAllSignalsWithSyncRun(
      {
        marketId,
        ...(forceAgentSlugs.length > 0 ? { forceAgentSlugs } : {}),
        ...(closeTimeGteIso ? { closeTimeGteIso } : {}),
        ...(closeTimeLteIso ? { closeTimeLteIso } : {}),
      },
      "manual",
    );
    if (outcome.kind === "skipped_overlap") {
      return NextResponse.json(
        { ok: true, queued: false, skipped: true, runId: outcome.runId },
        { status: 200 },
      );
    }
    return NextResponse.json({ ...outcome.result, runId: outcome.runId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "market evaluate-all signals failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; query `marketId`. */
export async function GET(request: Request) {
  return handle(request, "");
}

/** POST: Bearer CRON_SECRET; query `marketId`. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
