import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runHistoricalExecutorReplay } from "@/lib/historical/run-historical-executor-replay";
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
    const result = await runHistoricalExecutorReplay(admin, { executorId, userId: user.id });
    revalidatePath(`/executors/${executorId}`);
    revalidatePath(`/executors/${executorId}/orders`);
    revalidatePath(`/executors/${executorId}/trade-decisions`);
    revalidatePath(`/executors/${executorId}/positions`);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
