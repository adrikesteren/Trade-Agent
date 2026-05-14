import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { replaySignalsForBars } from "@/lib/agents/signal/services/replay-signals-for-bars.service";
import { fetchExchangeIdByCode } from "@/lib/agents/executor/services/executors-lookup.service";

import { ingestHistoricalCandles } from "@/lib/agents/ingest/services/historical-candles-ingest.service";
import { loadHistoricalCandlesForReplay } from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns today's UTC date as `YYYY-MM-DD`. */
export function todayUtcYmd(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type RunMarketBackfillCandlesArgs = {
  /** `catalog.markets.id`. Must be a Bitvavo market with a non-empty quote asset code. */
  marketId: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive UTC date `YYYY-MM-DD`. Defaults to today (UTC) when null/empty/omitted. */
  endDate?: string | null;
};

export type RunMarketBackfillCandlesResult = {
  ok: true;
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  /** Candle rows upserted into `catalog.candles` by the Ingest Agent. */
  candleRowsUpserted: number;
  /** Total bars the Signal Agent visited inside the replay window. */
  barsReplayed: number;
  /** Total `trading.signals` rows upserted by the Signal Agent across all bars. */
  signalsUpsertedTotal: number;
};

/**
 * "Backfill candles" runner — Ingest Agent then Signal Agent for one market over a [start, end] UTC window.
 *
 * 1. Validates the market is a Bitvavo market with a non-empty quote asset code.
 * 2. {@link ingestHistoricalCandles} pulls the OHLCV history from Bitvavo into `catalog.candles` (1440-bar batches).
 * 3. {@link loadHistoricalCandlesForReplay} loads warmup + window bars and asserts coverage.
 * 4. {@link replaySignalsForBars} upserts `trading.signals` for every closed bar (no mediator/executor side-effects).
 */
export async function runMarketBackfillCandles(
  admin: SupabaseClient,
  args: RunMarketBackfillCandlesArgs,
): Promise<RunMarketBackfillCandlesResult> {
  const startDate = args.startDate.trim();
  const rawEnd = (args.endDate ?? "").trim();
  const endDate = rawEnd || todayUtcYmd();

  if (!ISO_DATE_RE.test(startDate)) {
    throw new Error(`Invalid startDate "${startDate}" — expected YYYY-MM-DD.`);
  }
  if (!ISO_DATE_RE.test(endDate)) {
    throw new Error(`Invalid endDate "${endDate}" — expected YYYY-MM-DD.`);
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }

  const marketId = args.marketId.trim();
  if (!marketId) {
    throw new Error("marketId is required.");
  }

  const { data: mrow, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, exchange_id, quote_asset_id")
    .eq("id", marketId)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("Market not found.");
  const market = mrow as {
    id: string;
    market_symbol: string | null;
    exchange_id: string;
    quote_asset_id: string;
  };

  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(market.exchange_id) !== bitvavoId) {
    throw new Error("Backfill candles currently only supports Bitvavo markets.");
  }

  const { data: quoteRow, error: qErr } = await admin
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("id", market.quote_asset_id)
    .maybeSingle();
  if (qErr) throw new Error(qErr.message);
  const quote = String(quoteRow?.code ?? "").trim().toUpperCase();
  if (!quote) {
    throw new Error("Market is missing a quote asset code.");
  }

  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const marketSymbol = String(market.market_symbol ?? "");

  const ingest = await ingestHistoricalCandles(admin, {
    marketId,
    timeframe,
    quote,
    historicalStartDate: startDate,
    historicalEndDate: endDate,
  });

  const signalUserIds = await getCatalogPipelineUserIds(admin);
  if (signalUserIds.length === 0) {
    throw new Error(
      "Backfill candles requires the automated_process user (automation_actor or user_profiles.username = automated_process).",
    );
  }

  const loaded = await loadHistoricalCandlesForReplay(admin, {
    marketId,
    timeframe,
    historicalStartDate: startDate,
    historicalEndDate: endDate,
  });

  const { barsReplayed, signalsUpsertedTotal } = await replaySignalsForBars(admin, {
    marketId,
    marketSymbol,
    timeframe,
    sortedAll: loaded.sortedAll,
    replayCloses: loaded.replayCloses,
    signalUserIds,
  });

  return {
    ok: true,
    marketId,
    marketSymbol,
    timeframe,
    startDate,
    endDate,
    candleRowsUpserted: ingest.candleRowsUpserted,
    barsReplayed,
    signalsUpsertedTotal,
  };
}
