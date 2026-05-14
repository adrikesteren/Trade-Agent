import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReplayCandleBar } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

import { upsertSignalsForMarketCloseFromBars } from "./market-close-signal-upsert.service";

export type ReplaySignalsForBarsArgs = {
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  /** Warmup + replay bars, ascending — usually the `sortedAll` field from `loadHistoricalCandlesForReplay`. */
  sortedAll: ReplayCandleBar[];
  /** Bars whose close should produce signals (subset of `sortedAll`). */
  replayCloses: ReplayCandleBar[];
  /** `auth.users.id`s the upserted `trading.signals` rows are owned by. */
  signalUserIds: string[];
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  /**
   * Called after each bar finishes signal upsert. The default is a no-op; the historical executor
   * replay uses this hook to run the mediator + executor pipelines for the same close.
   */
  onBarComplete?: (ctx: {
    bar: ReplayCandleBar;
    barsAscThroughClose: ReplayCandleBar[];
    barsDone: number;
    barsTotal: number;
    signalsUpsertedForBar: number;
  }) => Promise<void> | void;
};

export type ReplaySignalsForBarsResult = {
  barsReplayed: number;
  signalsUpsertedTotal: number;
};

/**
 * Signal Agent — generates `trading.signals` for every closed bar in `replayCloses`.
 *
 * Reused by:
 * - `historical-executor-replay.service.ts` (with `onBarComplete` running mediator + executor)
 * - `market-backfill-candles.service.ts` (no-op `onBarComplete`)
 */
export async function replaySignalsForBars(
  admin: SupabaseClient,
  args: ReplaySignalsForBarsArgs,
): Promise<ReplaySignalsForBarsResult> {
  let signalsUpsertedTotal = 0;
  let barsReplayed = 0;

  for (const bar of args.replayCloses) {
    const targetCloseMs = Date.parse(bar.closeTimeIso);
    const barsThrough = args.sortedAll.filter((b) => Date.parse(b.closeTimeIso) <= targetCloseMs + 2);

    const signalsUpsertedForBar = await upsertSignalsForMarketCloseFromBars(admin, {
      marketId: args.marketId,
      marketSymbol: args.marketSymbol,
      timeframe: args.timeframe,
      closeTimeIso: bar.closeTimeIso,
      sortedBarsAsc: barsThrough,
      signalUserIds: args.signalUserIds,
      candleSyncRunId: args.candleSyncRunId ?? null,
      signalsSyncRunId: args.signalsSyncRunId ?? null,
    });
    signalsUpsertedTotal += signalsUpsertedForBar;
    barsReplayed += 1;

    if (args.onBarComplete) {
      await args.onBarComplete({
        bar,
        barsAscThroughClose: barsThrough,
        barsDone: barsReplayed,
        barsTotal: args.replayCloses.length,
        signalsUpsertedForBar,
      });
    }
  }

  return { barsReplayed, signalsUpsertedTotal };
}
