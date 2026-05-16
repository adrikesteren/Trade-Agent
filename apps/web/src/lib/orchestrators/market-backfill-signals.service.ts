import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutomatedProcessUserId } from "@/lib/automation-actor";
import { loadHistoricalCandlesForReplay } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";
import { replayMissingSignalsForBars } from "@/lib/agents/signal/services/replay-missing-signals-for-bars.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import * as CandlesSelector from "@/lib/selectors/candles-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";

import { todayUtcYmd } from "./market-backfill-candles.service";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type RunMarketBackfillSignalsArgs = {
  /** `catalog.markets.id`. */
  marketId: string;
  /** Inclusive UTC date `YYYY-MM-DD`. Required (caller resolves "earliest stored" before chunking). */
  startDate: string;
  /** Inclusive UTC date `YYYY-MM-DD`. Defaults to today (UTC) when null/empty/omitted. */
  endDate?: string | null;
};

export type RunMarketBackfillSignalsResult = {
  ok: true;
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  barsInspected: number;
  barsSkippedComplete: number;
  barsFilled: number;
  signalsUpsertedTotal: number;
};

/**
 * "Backfill signals" runner — for one market over a [start, end] UTC window.
 *
 * For every closed bar in the window, runs the smart {@link replayMissingSignalsForBars} wrapper which
 * skips bars that already have a signal from every active agent and otherwise upserts only for the
 * agents that are missing. Existing signals are never overwritten.
 *
 * Requires candles to already exist in `catalog.candles` for the window — run "Backfill candles" first
 * if needed. The caller (Relay enqueue wrapper) is responsible for splitting large windows into chunks.
 */
export async function runMarketBackfillSignals(
  admin: SupabaseClient,
  args: RunMarketBackfillSignalsArgs,
): Promise<RunMarketBackfillSignalsResult> {
  const marketId = args.marketId.trim();
  if (!marketId) throw new Error("marketId is required.");

  const startDate = args.startDate.trim();
  if (!ISO_DATE_RE.test(startDate)) {
    throw new Error(`Invalid startDate "${startDate}" — expected YYYY-MM-DD.`);
  }

  const rawEnd = (args.endDate ?? "").trim();
  const endDate = rawEnd || todayUtcYmd();
  if (!ISO_DATE_RE.test(endDate)) {
    throw new Error(`Invalid endDate "${endDate}" — expected YYYY-MM-DD.`);
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }

  const mrow = await MarketsSelector.selectIdAndSymbolById(admin, marketId);
  if (!mrow) throw new Error("Market not found.");
  const marketSymbol = String(mrow.market_symbol ?? "");

  const automatedUserId = await getAutomatedProcessUserId(admin);
  if (!automatedUserId) {
    throw new Error(
      "Backfill signals requires the automated_process user (automation_actor or user_profiles.username = automated_process).",
    );
  }

  const timeframe = CATALOG_STORAGE_TIMEFRAME;

  const loaded = await loadHistoricalCandlesForReplay(admin, {
    marketId,
    timeframe,
    historicalStartDate: startDate,
    historicalEndDate: endDate,
  });

  const { barsInspected, barsSkippedComplete, barsFilled, signalsUpsertedTotal } = await replayMissingSignalsForBars(
    admin,
    {
      marketId,
      marketSymbol,
      timeframe,
      sortedAll: loaded.sortedAll,
      replayCloses: loaded.replayCloses,
      signalUserIds: [automatedUserId],
    },
  );

  return {
    ok: true,
    marketId,
    marketSymbol,
    timeframe,
    startDate,
    endDate,
    barsInspected,
    barsSkippedComplete,
    barsFilled,
    signalsUpsertedTotal,
  };
}

/**
 * Returns the earliest stored `close_time` (UTC `YYYY-MM-DD`) for a market on the catalog storage
 * timeframe, or `null` when no candles exist.
 *
 * Used by the "Backfill Signals" wrapper to determine the start of the chunk range when the user just
 * presses the button without specifying dates.
 */
export async function fetchEarliestStoredCandleDate(
  admin: SupabaseClient,
  marketId: string,
): Promise<string | null> {
  const data = await CandlesSelector.selectEarliestCloseTimeForMarket(admin, {
    marketId,
    timeframe: CATALOG_STORAGE_TIMEFRAME,
  });
  const row = data[0];
  if (!row) return null;
  const ts = Array.isArray(row.candle_timestamps) ? row.candle_timestamps[0] : row.candle_timestamps;
  const iso = ts?.close_time?.trim();
  if (!iso) return null;
  return iso.slice(0, 10);
}
