import { NextResponse } from "next/server";

import { runCloseCandlePipeline } from "@/lib/orchestrators/close-candle-pipeline.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

type Body = {
  closeTimeIso?: unknown;
  executorId?: unknown;
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
  const closeTimeIso =
    typeof body.closeTimeIso === "string" && body.closeTimeIso.trim() ? body.closeTimeIso.trim() : undefined;
  const executorId =
    typeof body.executorId === "string" && body.executorId.trim() ? body.executorId.trim() : undefined;

  const admin = createServiceRoleClient();
  try {
    const result = await runCloseCandlePipeline(admin, { marketId, closeTimeIso, executorId });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "close candle pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; no body. */
export async function GET(request: Request, ctx: { params: Promise<{ marketId: string }> }) {
  return handle(request, "", ctx);
}

/** POST: Bearer CRON_SECRET; optional JSON body `{ closeTimeIso?: string, executorId?: string }`. */
export async function POST(request: Request, ctx: { params: Promise<{ marketId: string }> }) {
  const rawBody = await request.text();
  return handle(request, rawBody, ctx);
}
