import { NextResponse } from "next/server";

import { runHistoricalExecutorReplay } from "@/lib/orchestrators/historical-executor-replay.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { fetchExecutorById } from "@/lib/agents/executor/services/executors-lookup.service";
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
  const executorId = url.searchParams.get("executorId")?.trim() ?? "";
  if (!executorId) {
    return NextResponse.json({ error: "invalid_query", hint: "Required: ?executorId=<uuid>" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const row = await fetchExecutorById(admin, executorId);
  if (!row) {
    return NextResponse.json({ error: "executor_not_found" }, { status: 404 });
  }

  try {
    const result = await runHistoricalExecutorReplay(admin, { executorId, userId: row.user_id });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "historical replay failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: Bearer CRON_SECRET; query `executorId`. */
export async function GET(request: Request) {
  return handle(request, "");
}

/** POST: Bearer CRON_SECRET; query `executorId`. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
