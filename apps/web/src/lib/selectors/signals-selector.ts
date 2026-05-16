import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types — one per unique embed-shape used by callers.
// ──────────────────────────────────────────────────────────────────────────────

/** Narrow id-only projection (used by the executor catalog-close run). */
export type SignalIdRow = { id: string };

/** Narrow signal_agent_id-only projection (used by the replay smart-skip wrapper). */
export type SignalAgentIdRow = { signal_agent_id: string };

/**
 * Mediator catalog-close projection — `id, intent, created_at, metadata, signal_agents(agent_id)`
 * (every column the mediator needs to evaluate a decision for one user × candle).
 */
export type SignalForMediatorRow = {
  id: string;
  intent: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

/**
 * Market detail page projection — `id, signal_agent_id, created_at, intent, confidence,
 * candle_id, signal_agents(agent_id)`.
 */
export type SignalForMarketRelatedRow = {
  id: string;
  signal_agent_id: string;
  created_at: string;
  intent: string;
  confidence: number | string | null;
  candle_id: string;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

/**
 * Signals list-page projection — `id, signal_agent_id, candle_id, intent, confidence,
 * created_at, metadata, signal_agents(agent_id)`.
 */
export type SignalListRow = {
  id: string;
  signal_agent_id: string;
  candle_id: string;
  intent: string;
  confidence: number | string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

/**
 * Signals detail-page projection — `id, signal_agent_id, candle_id, intent, confidence,
 * reasons, metadata, created_at, signal_agents(agent_id)`.
 */
export type SignalDetailRow = {
  id: string;
  signal_agent_id: string;
  candle_id: string;
  intent: string;
  confidence: number | string | null;
  reasons: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

/**
 * SAR mediator projection — `metadata, candles!inner ( market_id, candle_timestamps!inner(close_time) )`.
 * Used to walk historical regime classifier signals for one (user, market) pair.
 */
export type SignalWithRegimeMetadataAndCandleRow = {
  metadata: Record<string, unknown> | null;
  candles?:
    | { candle_timestamps?: { close_time?: string } | { close_time?: string }[] | null }
    | { candle_timestamps?: { close_time?: string } | { close_time?: string }[] | null }[]
    | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id") .eq("user_id", x) .eq("candle_id", c)` — narrow id lookup used
 * by the executor catalog-close run to pull every signal for one (user, candle).
 */
export async function selectIdsByUserAndCandle(
  client: SupabaseClient,
  args: { userId: string; candleId: string },
): Promise<SignalIdRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select("id")
    .eq("user_id", args.userId)
    .eq("candle_id", args.candleId);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalIdRow[];
}

/**
 * `select("signal_agent_id") .eq("candle_id", c)` — smart-skip wrapper lookup
 * used by `replayMissingSignalsForBars` to count which agents already produced
 * a signal for the bar.
 */
export async function selectSignalAgentIdsByCandleId(
  client: SupabaseClient,
  candleId: string,
): Promise<SignalAgentIdRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select("signal_agent_id")
    .eq("candle_id", candleId);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalAgentIdRow[];
}

/**
 * `select("id, intent, created_at, metadata, signal_agents(agent_id)")
 *   .eq("user_id", x) .eq("candle_id", c)` — mediator catalog-close per-user / per-candle lookup.
 */
export async function selectForMediatorByUserAndCandle(
  client: SupabaseClient,
  args: { userId: string; candleId: string },
): Promise<SignalForMediatorRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select("id, intent, created_at, metadata, signal_agents ( agent_id )")
    .eq("user_id", args.userId)
    .eq("candle_id", args.candleId);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalForMediatorRow[];
}

/**
 * `select("id, signal_agent_id, created_at, intent, confidence, candle_id, signal_agents(agent_id)")
 *   .in("candle_id", ids)` — market detail page related-signals batch (caller chunks the IN list).
 */
export async function selectForMarketRelatedByCandleIds(
  client: SupabaseClient,
  candleIds: string[],
): Promise<SignalForMarketRelatedRow[]> {
  if (candleIds.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, created_at, intent, confidence, candle_id, signal_agents ( agent_id )",
    )
    .in("candle_id", candleIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalForMarketRelatedRow[];
}

/**
 * `select("id, signal_agent_id, candle_id, intent, confidence, created_at, metadata,
 *   signal_agents(agent_id)") .order("created_at", desc) .limit(N)` — signals list page raw fetch.
 */
export async function selectListLatestLimited(
  client: SupabaseClient,
  limit: number,
): Promise<SignalListRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, candle_id, intent, confidence, created_at, metadata, signal_agents ( agent_id )",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalListRow[];
}

/**
 * `select("id, signal_agent_id, candle_id, intent, confidence, reasons, metadata,
 *   created_at, signal_agents(agent_id)") .eq("id", id) .maybeSingle()` — detail-page lookup.
 */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<SignalDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, candle_id, intent, confidence, reasons, metadata, created_at, signal_agents ( agent_id )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SignalDetailRow | null) ?? null;
}

/**
 * `select("metadata, candles!inner ( market_id, candle_timestamps!inner(close_time) )")
 *   .eq("user_id", x) .eq("signal_agent_id", a)
 *   .lt("candles.candle_timestamps.close_time", iso) .eq("candles.market_id", m)
 *   .order("close_time", desc, foreignTable: "candles.candle_timestamps") .limit(N)`
 * — SAR mediator regime-history lookup (returns rows ordered DESC; caller reverses).
 */
export async function selectRegimeSignalsBeforeCloseTime(
  client: SupabaseClient,
  args: {
    userId: string;
    signalAgentId: string;
    marketId: string;
    beforeCloseTimeIso: string;
    limit: number;
  },
): Promise<SignalWithRegimeMetadataAndCandleRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signals")
    .select("metadata, candles!inner ( market_id, candle_timestamps!inner ( close_time ) )")
    .eq("user_id", args.userId)
    .eq("signal_agent_id", args.signalAgentId)
    .lt("candles.candle_timestamps.close_time", args.beforeCloseTimeIso)
    .eq("candles.market_id", args.marketId)
    .order("close_time", { ascending: false, foreignTable: "candles.candle_timestamps" })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalWithRegimeMetadataAndCandleRow[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(row, { onConflict: "user_id,signal_agent_id,candle_id" })` — single signal
 * upsert keyed by (user, agent, candle). Used by both the catalog-close run and the
 * historical replay path.
 */
export async function upsertOneByUserAgentCandle(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("signals")
    .upsert(row, { onConflict: "user_id,signal_agent_id,candle_id" });
  if (error) throw new Error(error.message);
}
