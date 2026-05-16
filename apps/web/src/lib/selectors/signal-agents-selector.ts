import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Active-agent projection — id + agent slug + config + allowed timeframes (signal-eval loops). */
export type SignalAgentActiveConfigRow = {
  id: string;
  agent_id: string;
  enabled: boolean;
  config: unknown;
  allowed_timeframes: string[] | null;
};

/** Smart-skip wrapper projection — id + allowed timeframes only (no config). */
export type SignalAgentIdAndTimeframesRow = {
  id: string;
  allowed_timeframes: string[] | null;
};

/** Slack label projection — agent slug + description. */
export type SignalAgentSlugAndDescriptionRow = {
  agent_id: string;
  description: string | null;
};

/** List-page projection — columns rendered by the `/signal-agents` list table. */
export type SignalAgentListRow = {
  id: string;
  agent_id: string;
  enabled: boolean;
  version: string | null;
  description: string | null;
  created_at: string;
  updated_at: string | null;
};

/** Detail-page projection — every column the `/signal-agents/[id]` page renders. */
export type SignalAgentDetailRow = {
  id: string;
  agent_id: string;
  enabled: boolean;
  version: string | null;
  description: string | null;
  config: Record<string, unknown> | null;
  allowed_timeframes: string[] | null;
  created_at: string;
  updated_at: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id, agent_id, enabled, config, allowed_timeframes") .eq("enabled", true)` —
 * full active-agents list used by the signal-evaluation loops (catalog-close + per-market).
 */
export async function selectActiveWithConfig(
  client: SupabaseClient,
): Promise<SignalAgentActiveConfigRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, config, allowed_timeframes")
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalAgentActiveConfigRow[];
}

/**
 * `select("id, allowed_timeframes") .eq("enabled", true)` — narrow lookup for the
 * "replay missing signals" smart-skip wrapper (no config needed).
 */
export async function selectActiveIdAndTimeframes(
  client: SupabaseClient,
): Promise<SignalAgentIdAndTimeframesRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("id, allowed_timeframes")
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalAgentIdAndTimeframesRow[];
}

/**
 * `select("agent_id, description")` — all agents (small table) for slack-label resolution.
 */
export async function selectSlugAndDescription(
  client: SupabaseClient,
): Promise<SignalAgentSlugAndDescriptionRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("agent_id, description");
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalAgentSlugAndDescriptionRow[];
}

/**
 * `select("id") .eq("agent_id", slug) .maybeSingle()` — resolve `signal_agents.id` from an
 * `agent_id` slug (used by the SAR mediator to find the regime-classifier row).
 */
export async function selectIdByAgentSlug(
  client: SupabaseClient,
  agentSlug: string,
): Promise<string | null> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("id")
    .eq("agent_id", agentSlug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  return id ?? null;
}

/**
 * `select("id, agent_id, enabled, version, description, created_at, updated_at")
 *   .order("created_at", { ascending: false }) .range(from, to)` — paginated list page.
 */
export async function selectAllPaginatedOrderedByCreatedAt(
  client: SupabaseClient,
  range: { from: number; to: number },
): Promise<SignalAgentListRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, version, description, created_at, updated_at")
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalAgentListRow[];
}

/**
 * `select(<detail-fields>) .eq("id", id) .maybeSingle()` — detail-page lookup by uuid.
 */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<SignalAgentDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select(
      "id, agent_id, enabled, version, description, config, allowed_timeframes, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SignalAgentDetailRow | null) ?? null;
}

/** `select("*", { count: "exact", head: true })` — total row count for pagination. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("signal_agents")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
