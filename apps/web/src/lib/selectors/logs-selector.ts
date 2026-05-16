import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type LogInsertRow = {
  user_id: string;
  level: AppLogLevel;
  message: string;
  context?: string | null;
  metadata?: Record<string, unknown>;
};

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `insert(row)` — single-row app log insert into `public.logs`. Must be called with a
 * session-scoped client so RLS pins `user_id` to the signed-in user. Errors are logged
 * to the server console rather than thrown, so a failed write never breaks the caller's
 * own error path.
 */
export async function insertOne(client: SupabaseClient, row: LogInsertRow): Promise<void> {
  const { error } = await client.from("logs").insert({
    user_id: row.user_id,
    level: row.level,
    message: row.message,
    context: row.context ?? null,
    metadata: row.metadata ?? {},
  });
  if (error) {
    console.error("[LogsSelector.insertOne]", error.message);
  }
}
