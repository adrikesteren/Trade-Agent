import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type EnabledSignalAgent = {
  /** `signal_agents.id` (UUID) — used to identify rows in `trading.signals.signal_agent_id`. */
  id: string;
  /** `signal_agents.agent_id` slug, e.g. `regime-classifier-15m-v1`. */
  slug: string;
  /** `null` / empty array means "applies to every timeframe". */
  allowedTimeframes: string[] | null;
  /** Raw `config` JSON from the row (or empty object). Used for warmup derivation. */
  config: Record<string, unknown>;
};

/**
 * Fetch all enabled rows from `trading.signal_agents`. When `args.timeframe` is set, the result
 * is filtered to agents whose `allowed_timeframes` is null/empty (= applies to all) or contains
 * the given timeframe.
 *
 * Used by the historical-replay orchestrator (warmup derivation), the evaluate-all-signals
 * worker (gap-fill), and the historical signal replay (coverage / gap-fill). Centralised so
 * we always count "the signal agents we have" the same way — never hardcoded to 5.
 */
export async function fetchEnabledSignalAgents(
  admin: SupabaseClient,
  args?: { timeframe?: string },
): Promise<EnabledSignalAgent[]> {
  const { data, error } = await admin
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, allowed_timeframes, config")
    .eq("enabled", true);
  if (error) throw new Error(`signal_agents lookup: ${error.message}`);

  const tf = args?.timeframe;
  const rows = (data ?? []) as {
    id: string;
    agent_id: string;
    allowed_timeframes: string[] | null;
    config: Record<string, unknown> | null;
  }[];
  const filtered = tf
    ? rows.filter((a) => {
        const allowed = a.allowed_timeframes;
        if (!allowed || allowed.length === 0) return true;
        return allowed.includes(tf);
      })
    : rows;

  return filtered.map((a) => ({
    id: String(a.id),
    slug: String(a.agent_id),
    allowedTimeframes: a.allowed_timeframes,
    config: (a.config ?? {}) as Record<string, unknown>,
  }));
}
