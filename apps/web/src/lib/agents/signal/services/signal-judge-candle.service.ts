import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { loadHistoricalCandlesForReplay } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";
import * as MarketsSelector from "@/lib/selectors/markets-selector";

import { replaySignalsForBars } from "./replay-signals-for-bars.service";

export type SignalJudgeForMarketWindowArgs = {
  marketId: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  endDate: string;
  /** `auth.users.id`s the upserted `trading.signals` rows are owned by. */
  signalUserIds: string[];
};

export type SignalJudgeForMarketWindowResult = {
  barsReplayed: number;
  signalsUpsertedTotal: number;
  marketSymbol: string;
  timeframe: string;
};

/**
 * Adapter-agnostic Signal Agent entry point for a `[startDate, endDate]` window on one market.
 * Loads warmup + replay bars via {@link loadHistoricalCandlesForReplay} and delegates to
 * {@link replaySignalsForBars} (no-op `onBarComplete` — mediator/executor steps are driven by
 * the orchestrator). Reuses the existing `upsertSignalsForMarketCloseFromBars` pipeline so all
 * agent evaluators (MA-cross, RSI-reversion, Breakout-ATR, regime, multi-timeframe) keep
 * their current semantics.
 */
export async function runSignalJudgeForMarketWindow(
  admin: SupabaseClient,
  args: SignalJudgeForMarketWindowArgs,
): Promise<SignalJudgeForMarketWindowResult> {
  const timeframe = CATALOG_STORAGE_TIMEFRAME;

  const market = await MarketsSelector.selectIdAndSymbolById(admin, args.marketId);
  if (!market) throw new Error(`Market not found: ${args.marketId}`);
  const marketSymbol = String(market.market_symbol ?? "");

  const loaded = await loadHistoricalCandlesForReplay(admin, {
    marketId: args.marketId,
    timeframe,
    historicalStartDate: args.startDate,
    historicalEndDate: args.endDate,
  });

  const { barsReplayed, signalsUpsertedTotal } = await replaySignalsForBars(admin, {
    marketId: args.marketId,
    marketSymbol,
    timeframe,
    sortedAll: loaded.sortedAll,
    replayCloses: loaded.replayCloses,
    signalUserIds: args.signalUserIds,
  });

  return {
    barsReplayed,
    signalsUpsertedTotal,
    marketSymbol,
    timeframe,
  };
}
