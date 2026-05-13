import type { SupabaseClient } from "@supabase/supabase-js";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

/** Inserts into `public.logs` using a session-scoped client (RLS: `user_id` must be the signed-in user). */
export async function insertUserAppLog(
  supabase: SupabaseClient,
  args: {
    userId: string;
    level: AppLogLevel;
    message: string;
    context?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("logs").insert({
    user_id: args.userId,
    level: args.level,
    message: args.message,
    context: args.context ?? null,
    metadata: args.metadata ?? {},
  });
  if (error) {
    console.error("[insertUserAppLog]", error.message);
  }
}
