import type { SupabaseClient } from "@supabase/supabase-js";

export type ExecutionMode = "paper" | "live";

/** `true` when positions/trade rows use the paper book (`trading.positions.paper = true`). */
export async function fetchUserUsesPaperBook(
  admin: SupabaseClient,
  userId: string,
): Promise<{ executionMode: ExecutionMode; decisionPaperColumn: boolean }> {
  const { data, error } = await admin
    .schema("trading")
    .from("user_execution_preferences")
    .select("execution_mode")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const mode = (data?.execution_mode as ExecutionMode | undefined) ?? "paper";
  const isLive = mode === "live";
  return {
    executionMode: mode,
    decisionPaperColumn: !isLive,
  };
}
