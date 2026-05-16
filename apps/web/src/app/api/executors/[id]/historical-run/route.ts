import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { runHistoricalExecutorReplay } from "@/lib/orchestrators/historical-executor-replay.service";
import * as LogsSelector from "@/lib/selectors/logs-selector";
import {
  buildHistoricalExecutorReplayWorkerUrl,
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  makeRelayClient,
  RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S,
  relayMaxRetries,
  toRelayOriginAndPath,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchExecutorById } from "@/lib/agents/executor/services/executors-lookup.service";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: executorId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (await isRelayWorkerEnqueueConfigured()) {
      const admin = createServiceRoleClient();
      const row = await fetchExecutorById(admin, executorId);
      if (!row || row.user_id !== user.id) {
        return NextResponse.json({ ok: false, error: "Executor not found." }, { status: 404 });
      }
      const relay = makeRelayClient();
      const appBase = getAppBaseUrl();
      const { origin, path } = toRelayOriginAndPath(buildHistoricalExecutorReplayWorkerUrl(appBase, executorId));
      const { message } = await relay.messages.enqueue({
        origin,
        path,
        method: "POST",
        headers: await downstreamWorkerHeaders(),
        maxRetries: relayMaxRetries(),
        timeout: RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S,
      });
      return NextResponse.json({ ok: true, queued: true, relayMessageId: message.id });
    }

    const admin = createServiceRoleClient();
    const result = await runHistoricalExecutorReplay(admin, { executorId, userId: user.id });
    revalidatePath(`/executors/${executorId}`);
    revalidatePath(`/executors/${executorId}/orders`);
    revalidatePath(`/executors/${executorId}/trade-decisions`);
    revalidatePath(`/executors/${executorId}/positions`);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await LogsSelector.insertOne(supabase, {
      user_id: user.id,
      level: "error",
      message: msg,
      context: "POST /api/executors/[id]/historical-run",
      metadata: { executorId },
    });
    revalidatePath("/logs");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
