import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReplayCandleBar } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

import { fetchEnabledSignalAgents } from "./enabled-signal-agents-fetch.service";
import { loadSignalCoverage, missingAgentIdsForCandle } from "./signal-coverage.service";
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
   * When `true`, pre-load `(agent, candle)` coverage from `trading.signals` for the
   * replay bars, then for each bar:
   *
   * - Skip the upsert entirely when every enabled signal agent already has a row.
   * - Pass `onlyAgentIds` so we evaluate only the missing agents otherwise.
   *
   * Trade decisions still run via `onBarComplete` for every replay bar — the mediator
   * reads the (already-existing) signals from `trading.signals` and produces decisions
   * just as if we had freshly written them. Defaults to `false` for backwards-compatible
   * "always re-evaluate every agent every bar" behavior.
   */
  reuseExistingSignals?: boolean;
  /**
   * Called after each bar finishes signal upsert (or is skipped due to full reuse).
   * The default is a no-op; the historical executor replay uses this hook to run the
   * mediator + executor pipelines for the same close.
   */
  onBarComplete?: (ctx: {
    bar: ReplayCandleBar;
    barsAscThroughClose: ReplayCandleBar[];
    barsDone: number;
    barsTotal: number;
    signalsUpsertedForBar: number;
    /** `true` when this bar was completely covered by pre-existing signals (no upsert call). */
    barReusedExistingSignals: boolean;
  }) => Promise<void> | void;
};

export type ReplaySignalsForBarsResult = {
  barsReplayed: number;
  signalsUpsertedTotal: number;
  /** Bars whose signals were fully reused from `trading.signals` (no Signal Agent eval). */
  barsReusedFromExistingSignals: number;
  /** Bars that needed a partial gap-fill (some agents missing, some present). */
  barsPartiallyReused: number;
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
  let barsReusedFromExistingSignals = 0;
  let barsPartiallyReused = 0;

  // Coverage-aware fast path: pre-load which `(agent, candle)` tuples already have a
  // `trading.signals` row so we can skip fully-covered bars and gap-fill partials. We
  // resolve the **enabled agent ids** the same way `upsertSignalsForMarketCloseFromBars`
  // does internally — never hardcoded — so the count is always "the agents we have".
  let enabledAgentIds: ReadonlySet<string> | null = null;
  let coverage: Map<string, Set<string>> | null = null;
  if (args.reuseExistingSignals) {
    const enabled = await fetchEnabledSignalAgents(admin, { timeframe: args.timeframe });
    enabledAgentIds = new Set(enabled.map((a) => a.id));
    if (enabledAgentIds.size > 0) {
      const candleIds = args.replayCloses.map((b) => b.id).filter((id): id is string => Boolean(id));
      coverage = await loadSignalCoverage(admin, candleIds, args.signalUserIds);
    } else {
      coverage = new Map();
    }
  }

  for (const bar of args.replayCloses) {
    const targetCloseMs = Date.parse(bar.closeTimeIso);
    const barsThrough = args.sortedAll.filter((b) => Date.parse(b.closeTimeIso) <= targetCloseMs + 2);

    let signalsUpsertedForBar = 0;
    let barReusedExistingSignals = false;

    if (args.reuseExistingSignals && enabledAgentIds && coverage && bar.id) {
      const missing = missingAgentIdsForCandle(enabledAgentIds, coverage, bar.id);
      if (missing.size === 0) {
        // Every enabled agent already has a `trading.signals` row for this candle.
        // Skip the eval/upsert entirely; the mediator (`onBarComplete`) still runs
        // and reads the existing signals.
        barReusedExistingSignals = true;
        barsReusedFromExistingSignals += 1;
      } else {
        if (missing.size < enabledAgentIds.size) {
          barsPartiallyReused += 1;
        }
        signalsUpsertedForBar = await upsertSignalsForMarketCloseFromBars(admin, {
          marketId: args.marketId,
          marketSymbol: args.marketSymbol,
          timeframe: args.timeframe,
          closeTimeIso: bar.closeTimeIso,
          sortedBarsAsc: barsThrough,
          signalUserIds: args.signalUserIds,
          candleSyncRunId: args.candleSyncRunId ?? null,
          signalsSyncRunId: args.signalsSyncRunId ?? null,
          onlyAgentIds: missing,
        });
      }
    } else {
      signalsUpsertedForBar = await upsertSignalsForMarketCloseFromBars(admin, {
        marketId: args.marketId,
        marketSymbol: args.marketSymbol,
        timeframe: args.timeframe,
        closeTimeIso: bar.closeTimeIso,
        sortedBarsAsc: barsThrough,
        signalUserIds: args.signalUserIds,
        candleSyncRunId: args.candleSyncRunId ?? null,
        signalsSyncRunId: args.signalsSyncRunId ?? null,
      });
    }

    signalsUpsertedTotal += signalsUpsertedForBar;
    barsReplayed += 1;

    if (args.onBarComplete) {
      await args.onBarComplete({
        bar,
        barsAscThroughClose: barsThrough,
        barsDone: barsReplayed,
        barsTotal: args.replayCloses.length,
        signalsUpsertedForBar,
        barReusedExistingSignals,
      });
    }
  }

  return {
    barsReplayed,
    signalsUpsertedTotal,
    barsReusedFromExistingSignals,
    barsPartiallyReused,
  };
}
