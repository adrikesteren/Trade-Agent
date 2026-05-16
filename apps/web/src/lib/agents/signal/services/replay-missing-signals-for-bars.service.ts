import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReplayCandleBar } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

import { upsertSignalsForMarketCloseFromBars } from "./market-close-signal-upsert.service";

export type ReplayMissingSignalsForBarsArgs = {
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  /** Warmup + replay bars, ascending — usually the `sortedAll` from `loadHistoricalCandlesForReplay`. */
  sortedAll: ReplayCandleBar[];
  /** Bars whose close should be checked + filled (subset of `sortedAll`). */
  replayCloses: ReplayCandleBar[];
  /** `auth.users.id`s the upserted `trading.signals` rows are owned by. */
  signalUserIds: string[];
};

export type ReplayMissingSignalsForBarsResult = {
  /** Number of replayCloses bars inspected. */
  barsInspected: number;
  /** Bars where at least one agent already produced a signal — fully complete bars are skipped. */
  barsSkippedComplete: number;
  /** Bars that triggered a partial fill (some agents missing). */
  barsFilled: number;
  /** `trading.signals` rows upserted across all bars. */
  signalsUpsertedTotal: number;
};

/**
 * Smart wrapper around {@link upsertSignalsForMarketCloseFromBars} for the "Backfill Signals" action.
 *
 * For every bar in `replayCloses`:
 * 1. Counts existing `trading.signals` rows per `signal_agents.id` for the bar's `candle_id`.
 * 2. Compares against the set of active agents that match this `timeframe`.
 * 3. If complete, skips the bar.
 * 4. If incomplete, upserts only for the missing agent ids (`agentIdFilter`).
 *
 * Existing signals are never overwritten — incomplete bars only get rows for agents that have not yet
 * produced a signal for the candle.
 */
export async function replayMissingSignalsForBars(
  admin: SupabaseClient,
  args: ReplayMissingSignalsForBarsArgs,
): Promise<ReplayMissingSignalsForBarsResult> {
  const { data: agentRows, error: agentErr } = await admin
    .schema("trading")
    .from("signal_agents")
    .select("id, allowed_timeframes")
    .eq("enabled", true);
  if (agentErr) throw new Error(agentErr.message);

  const activeAgentIds = (agentRows ?? [])
    .filter((a) => {
      const tf = (a as { allowed_timeframes: string[] | null }).allowed_timeframes;
      if (!tf || tf.length === 0) return true;
      return tf.includes(args.timeframe);
    })
    .map((a) => String((a as { id: string }).id));

  const activeAgentIdSet = new Set(activeAgentIds);
  const expectedCount = activeAgentIdSet.size;

  let barsInspected = 0;
  let barsSkippedComplete = 0;
  let barsFilled = 0;
  let signalsUpsertedTotal = 0;

  for (const bar of args.replayCloses) {
    barsInspected += 1;
    if (expectedCount === 0) continue;

    const { data: existingRows, error: sigErr } = await admin
      .schema("trading")
      .from("signals")
      .select("signal_agent_id")
      .eq("candle_id", bar.id);
    if (sigErr) throw new Error(`signals lookup for candle ${bar.id}: ${sigErr.message}`);

    const existingAgentIds = new Set(
      (existingRows ?? []).map((r) => String((r as { signal_agent_id: string }).signal_agent_id)),
    );

    const missingAgentIds = activeAgentIds.filter((id) => !existingAgentIds.has(id));
    if (missingAgentIds.length === 0) {
      barsSkippedComplete += 1;
      continue;
    }

    const targetCloseMs = Date.parse(bar.closeTimeIso);
    const barsThrough = args.sortedAll.filter((b) => Date.parse(b.closeTimeIso) <= targetCloseMs + 2);

    const upserted = await upsertSignalsForMarketCloseFromBars(admin, {
      marketId: args.marketId,
      marketSymbol: args.marketSymbol,
      timeframe: args.timeframe,
      closeTimeIso: bar.closeTimeIso,
      sortedBarsAsc: barsThrough,
      signalUserIds: args.signalUserIds,
      agentIdFilter: missingAgentIds,
    });
    barsFilled += 1;
    signalsUpsertedTotal += upserted;
  }

  return { barsInspected, barsSkippedComplete, barsFilled, signalsUpsertedTotal };
}
