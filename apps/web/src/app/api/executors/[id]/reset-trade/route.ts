import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { resetHistoricalExecutorTradeState } from "@/lib/agents/executor/services/historical-executor-trade-reset.service";
import * as LogsSelector from "@/lib/selectors/logs-selector";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
    const admin = createServiceRoleClient();
    const result = await resetHistoricalExecutorTradeState(admin, {
      executorId,
      userId: user.id,
    });
    revalidatePath(`/executors/${executorId}`);
    revalidatePath(`/executors/${executorId}/orders`);
    revalidatePath(`/executors/${executorId}/positions`);
    revalidatePath(`/executors/${executorId}/trade-decisions`);
    revalidatePath(`/executors/${executorId}/wallet-asset-balance`);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await LogsSelector.insertOne(supabase, {
      user_id: user.id,
      level: "error",
      message: msg,
      context: "POST /api/executors/[id]/reset-trade",
      metadata: { executorId },
    });
    revalidatePath("/logs");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
