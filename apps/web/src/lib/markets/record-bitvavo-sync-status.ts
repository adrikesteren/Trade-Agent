import type { SupabaseClient } from "@supabase/supabase-js";

export const BITVAVO_SYNC_JOB_MARKETS_EUR = "bitvavo_markets_eur";
export const BITVAVO_SYNC_JOB_CANDLES_EUR = "bitvavo_candles_eur";
export type BitvavoSyncTriggerSource = "manual" | "automated";

export async function recordBitvavoSyncSuccess(
  admin: SupabaseClient,
  jobKey: string,
  source: BitvavoSyncTriggerSource = "automated",
): Promise<void> {
  const now = new Date().toISOString();
  const { error } =
    source === "automated"
      ? await admin.from("bitvavo_sync_status").upsert(
          {
            job_key: jobKey,
            last_success_at: now,
            updated_at: now,
            last_trigger_source: source,
            last_automated_success_at: now,
          },
          { onConflict: "job_key" },
        )
      : await admin.from("bitvavo_sync_status").upsert(
          {
            job_key: jobKey,
            last_success_at: now,
            updated_at: now,
            last_trigger_source: source,
          },
          { onConflict: "job_key" },
        );
  if (error) throw new Error(`bitvavo_sync_status: ${error.message}`);
}
