import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Chunk size for `signals.candle_id IN (...)` filters. Conservative limit so we stay well
 * under PostgREST URI caps when paging coverage lookups across thousands of candles.
 */
export const SIGNAL_COVERAGE_CHUNK = 100;

/**
 * Build `Map<candleId, Set<signalAgentId>>` of `(agent, candle)` tuples that already have a
 * `trading.signals` row for any of `signalUserIds`. Chunked on `candle_id IN (...)` so we
 * stay under PostgREST URI limits.
 *
 * Reused by:
 * - `market-evaluate-all-signals.service.ts` (skip-existing for the evaluate-all worker).
 * - `replay-signals-for-bars.service.ts` (skip-existing for the historical executor replay).
 */
export async function loadSignalCoverage(
  admin: SupabaseClient,
  candleIds: string[],
  signalUserIds: string[],
): Promise<Map<string, Set<string>>> {
  const coverage = new Map<string, Set<string>>();
  if (candleIds.length === 0 || signalUserIds.length === 0) return coverage;

  for (let i = 0; i < candleIds.length; i += SIGNAL_COVERAGE_CHUNK) {
    const chunk = candleIds.slice(i, i + SIGNAL_COVERAGE_CHUNK);
    const { data, error } = await admin
      .schema("trading")
      .from("signals")
      .select("signal_agent_id, candle_id")
      .in("user_id", signalUserIds)
      .in("candle_id", chunk);
    if (error) throw new Error(`signals coverage: ${error.message}`);

    for (const r of (data ?? []) as { signal_agent_id: string; candle_id: string }[]) {
      const cid = String(r.candle_id ?? "").trim();
      const aid = String(r.signal_agent_id ?? "").trim();
      if (!cid || !aid) continue;
      let set = coverage.get(cid);
      if (!set) {
        set = new Set<string>();
        coverage.set(cid, set);
      }
      set.add(aid);
    }
  }

  return coverage;
}

/**
 * For one bar, derive the agent ids that still need a signal: `enabledAgentIds \ covered`.
 * Returns an empty set when the bar already has full coverage.
 *
 * `forceAgentIds` (optional) is treated as "always missing" — agents in this set get
 * re-evaluated even when coverage already exists. The signal upserter will overwrite the
 * existing row in place (ON CONFLICT DO UPDATE), so the row id is preserved and downstream
 * FK references (`trading.decisions.signal_id`, etc.) remain valid.
 */
export function missingAgentIdsForCandle(
  enabledAgentIds: ReadonlySet<string>,
  coverage: Map<string, Set<string>>,
  candleId: string,
  forceAgentIds?: ReadonlySet<string>,
): Set<string> {
  const covered = coverage.get(candleId);
  const missing = new Set<string>();
  for (const aid of enabledAgentIds) {
    if (forceAgentIds?.has(aid)) {
      missing.add(aid);
      continue;
    }
    if (!covered?.has(aid)) missing.add(aid);
  }
  return missing;
}
