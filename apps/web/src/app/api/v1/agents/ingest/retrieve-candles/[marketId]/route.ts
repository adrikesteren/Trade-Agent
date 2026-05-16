import { NextResponse } from "next/server";

import { runIngestRetrieveCandles } from "@/lib/agents/ingest/services/ingest-retrieve-candles.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

type Body = {
  startDate?: unknown;
  endDate?: unknown;
};

function parseBody(rawBody: string): Body {
  if (!rawBody) return {};
  try {
    const j = JSON.parse(rawBody) as Body;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** Returns today's UTC date as `YYYY-MM-DD`. */
function todayUtcYmd(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function handle(
  request: Request,
  rawBody: string,
  ctx: { params: Promise<{ marketId: string }> },
): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const { marketId: marketIdRaw } = await ctx.params;
  const marketId = String(marketIdRaw ?? "").trim();
  if (!marketId) {
    return NextResponse.json(
      { error: "invalid_path", hint: "Required path segment: /[marketId]" },
      { status: 400 },
    );
  }

  const body = parseBody(rawBody);
  const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
  const endDateRaw = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const endDate = endDateRaw || todayUtcYmd();

  if (!startDate) {
    return NextResponse.json(
      { error: "invalid_body", hint: "Required JSON body: { startDate: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD' }" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  try {
    const result = await runIngestRetrieveCandles(admin, { marketId, startDate, endDate });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "ingest retrieve candles failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; no body — clients should use POST with a JSON body. */
export async function GET(request: Request, ctx: { params: Promise<{ marketId: string }> }) {
  return handle(request, "", ctx);
}

/** POST: Bearer CRON_SECRET; JSON body `{ startDate: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD' }`. */
export async function POST(request: Request, ctx: { params: Promise<{ marketId: string }> }) {
  const rawBody = await request.text();
  return handle(request, rawBody, ctx);
}
