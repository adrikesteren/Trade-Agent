import { NextResponse } from "next/server";

import { enqueueExchangeClosePipeline } from "@/lib/orchestrators/exchange-close-candle-pipeline.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

type Body = { quoteCode?: unknown };

function parseBody(rawBody: string): Body {
  if (!rawBody) return {};
  try {
    const j = JSON.parse(rawBody) as Body;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

async function handle(
  request: Request,
  rawBody: string,
  ctx: { params: Promise<{ exchangeId: string }> },
): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const { exchangeId: exchangeIdRaw } = await ctx.params;
  const exchangeId = String(exchangeIdRaw ?? "").trim();
  if (!exchangeId) {
    return NextResponse.json(
      { error: "invalid_path", hint: "Required path segment: /[exchangeId]" },
      { status: 400 },
    );
  }

  const body = parseBody(rawBody);
  const quoteCode =
    typeof body.quoteCode === "string" && body.quoteCode.trim() ? body.quoteCode.trim() : undefined;

  const admin = createServiceRoleClient();
  try {
    const result = await enqueueExchangeClosePipeline(admin, { exchangeId, quoteCode });
    if (!result.ok) {
      const status = result.error === "unknown_quote_asset" ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "exchange close pipeline enqueue failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; no body. */
export async function GET(request: Request, ctx: { params: Promise<{ exchangeId: string }> }) {
  return handle(request, "", ctx);
}

/** POST: Bearer CRON_SECRET; optional JSON body `{ quoteCode?: string }` (default EUR). */
export async function POST(request: Request, ctx: { params: Promise<{ exchangeId: string }> }) {
  const rawBody = await request.text();
  return handle(request, rawBody, ctx);
}
