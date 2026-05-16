import { NextResponse } from "next/server";

import { enqueueExecutorHistoricalRun } from "@/lib/orchestrators/executor-historical-run.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

async function handle(
  request: Request,
  rawBody: string,
  ctx: { params: Promise<{ executorId: string }> },
): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const { executorId: executorIdRaw } = await ctx.params;
  const executorId = String(executorIdRaw ?? "").trim();
  if (!executorId) {
    return NextResponse.json(
      { error: "invalid_path", hint: "Required path segment: /[executorId]" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  try {
    const result = await enqueueExecutorHistoricalRun(admin, { executorId });
    if (!result.ok) {
      const status = result.error === "executor_not_found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "executor historical run enqueue failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; no body. */
export async function GET(request: Request, ctx: { params: Promise<{ executorId: string }> }) {
  return handle(request, "", ctx);
}

/** POST: Bearer CRON_SECRET; no body. */
export async function POST(request: Request, ctx: { params: Promise<{ executorId: string }> }) {
  const rawBody = await request.text();
  return handle(request, rawBody, ctx);
}
