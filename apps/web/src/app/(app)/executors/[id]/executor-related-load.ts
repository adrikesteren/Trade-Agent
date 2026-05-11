import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareSignalsByCloseTimeThenIntent } from "./executor-related-sort";

export type ExecutorSignalRow = {
  id: string;
  signal_agent_id: string;
  market_id: string;
  timeframe: string;
  close_time: string;
  intent: string;
  confidence: number | string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

/**
 * Signals linked to this executor via `trade_decisions.signal_id` (signals have no `executor_id`).
 */
export async function fetchSignalsLinkedViaDecisions(
  supabase: SupabaseClient,
  executorId: string,
): Promise<{ rows: ExecutorSignalRow[]; error?: string }> {
  const { data: decRows, error: dErr } = await supabase
    .schema("trading")
    .from("trade_decisions")
    .select("signal_id, close_time")
    .eq("executor_id", executorId)
    .not("signal_id", "is", null)
    .order("close_time", { ascending: false })
    .limit(200);

  if (dErr) return { rows: [], error: dErr.message };

  const seen = new Set<string>();
  const signalIdsOrdered: string[] = [];
  for (const r of decRows ?? []) {
    const sid = r.signal_id as string | null;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    signalIdsOrdered.push(sid);
  }

  if (!signalIdsOrdered.length) return { rows: [] };

  const CHUNK = 100;
  const byId = new Map<string, ExecutorSignalRow>();
  for (let i = 0; i < signalIdsOrdered.length; i += CHUNK) {
    const chunk = signalIdsOrdered.slice(i, i + CHUNK);
    const { data: sigRows, error: sErr } = await supabase
      .schema("trading")
      .from("signals")
      .select(
        "id, signal_agent_id, market_id, timeframe, close_time, intent, confidence, created_at, metadata, signal_agents ( agent_id )",
      )
      .in("id", chunk);
    if (sErr) return { rows: [], error: sErr.message };
    for (const s of (sigRows ?? []) as ExecutorSignalRow[]) {
      byId.set(s.id, s);
    }
  }

  const ordered = signalIdsOrdered.map((id) => byId.get(id)).filter((x): x is ExecutorSignalRow => Boolean(x));
  ordered.sort(compareSignalsByCloseTimeThenIntent);

  const seenPair = new Set<string>();
  const deduped = ordered.filter((row) => {
    const key = `${row.market_id}::${row.signal_agent_id}`;
    if (seenPair.has(key)) return false;
    seenPair.add(key);
    return true;
  });

  return { rows: deduped.slice(0, DASHBOARD_LIST_VIEW_LIMIT) };
}

function agentSlugFromSignalRow(row: ExecutorSignalRow): string | null {
  const rel = row.signal_agents;
  if (!rel) return null;
  const first = Array.isArray(rel) ? rel[0] : rel;
  return first?.agent_id ?? null;
}

export function formatExecutorSignalSummary(row: ExecutorSignalRow, marketLabel: string): string {
  const agent = agentSlugFromSignalRow(row);
  return [row.timeframe, marketLabel, agent ? `@${agent}` : null].filter(Boolean).join(" · ");
}
