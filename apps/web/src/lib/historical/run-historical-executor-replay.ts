import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { timeframeDurationMs } from "@/lib/markets/prepare-eur-candle-timestamp-window";
import { runExecutorCatalogCloseDrain } from "@/lib/executor/run-executor-catalog-close";
import { runMediatorCatalogCloseDrain } from "@/lib/mediator/run-mediator-catalog-close";
import { fetchExchangeIdByCode } from "@/lib/trading/executors";

import { computeHistoricalCandleWindow } from "./historical-candle-window";
import { ingestHistoricalExecutorCandles } from "./ingest-historical-executor-candles";
import { upsertSignalsForMarketCloseFromBars } from "./upsert-signals-for-market-close";
import { wipeHistoricalExecutorSimulationState } from "./wipe-historical-executor-simulation";

/** Extra closed bars before the replay window so MA/ATR/RSI have enough history. */
const WARMUP_BARS = 120;

type CandleRowDb = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps: { close_time: string; open_time: string } | { close_time: string; open_time: string }[] | null;
};

function mapCandleRows(rows: CandleRowDb[]): {
  id: string;
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
}[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return {
        id: r.id,
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        closeTimeIso: closeTime,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function loadCandlesThroughRange(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<
  {
    id: string;
    high: number;
    low: number;
    close: number;
    closeTimeIso: string;
  }[]
> {
  const { data: tsRows, error: tsErr } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .select("id")
    .gte("close_time", args.closeTimeGteIso)
    .lte("close_time", args.closeTimeLteIso)
    .order("close_time", { ascending: true });
  if (tsErr) throw new Error(tsErr.message);
  const tsIds = (tsRows ?? []).map((r) => r.id as string).filter(Boolean);
  const out: CandleRowDb[] = [];
  const chunk = 400;
  for (let i = 0; i < tsIds.length; i += chunk) {
    const part = tsIds.slice(i, i + chunk);
    const { data: cRows, error: cErr } = await admin
      .schema("catalog")
      .from("candles")
      .select("id, open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
      .eq("market_id", args.marketId)
      .eq("timeframe", args.timeframe)
      .in("candle_timestamp_id", part);
    if (cErr) throw new Error(cErr.message);
    out.push(...((cRows ?? []) as CandleRowDb[]));
  }
  return mapCandleRows(out);
}

export type HistoricalExecutorReplayResult = {
  ok: true;
  runId: string;
  barsReplayed: number;
  candleRowsUpserted: number;
  signalsUpsertedTotal: number;
  decisionsUpsertedTotal: number;
  ordersInsertedTotal: number;
};

export async function runHistoricalExecutorReplay(
  admin: SupabaseClient,
  args: { executorId: string; userId: string },
): Promise<HistoricalExecutorReplayResult> {
  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const quote = "EUR";
  const stepMs = timeframeDurationMs(timeframe);

  const { data: exRow, error: exErr } = await admin
    .schema("trading")
    .from("executors")
    .select(
      "id, user_id, exchange_id, name, enabled, execution_mode, asset_filter_mode, filter_asset_ids, historical_start_date, historical_end_date",
    )
    .eq("id", args.executorId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!exRow) throw new Error("Executor not found.");
  const ex = exRow as {
    id: string;
    user_id: string;
    exchange_id: string;
    name: string;
    enabled: boolean;
    execution_mode: string;
    asset_filter_mode: string;
    filter_asset_ids: string[] | null;
    historical_start_date?: string | null;
    historical_end_date?: string | null;
  };
  if (ex.execution_mode !== "historical") {
    throw new Error("Executor is not in historical mode.");
  }
  if (!ex.enabled) {
    throw new Error("Executor must be enabled to run a historical replay.");
  }
  const hStart = String(ex.historical_start_date ?? "").trim();
  const hEnd = String(ex.historical_end_date ?? "").trim();
  if (!hStart || !hEnd) {
    throw new Error("Historical start and end dates are required.");
  }
  const assetIds = (ex.filter_asset_ids as string[] | null)?.filter(Boolean) ?? [];
  if (assetIds.length !== 1) {
    throw new Error("Historical executor must have exactly one whitelisted asset.");
  }
  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(ex.exchange_id) !== bitvavoId) {
    throw new Error("Historical replay requires a Bitvavo executor exchange.");
  }

  const { data: mkt, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("exchange_id", bitvavoId)
    .eq("asset_id", assetIds[0]!)
    .eq("quote_code", quote)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mkt?.id) {
    throw new Error("No Bitvavo EUR market found for the selected asset.");
  }
  const marketId = mkt.id as string;
  const marketSymbol = String(mkt.market_symbol ?? "");

  const { data: rs, error: rsErr } = await admin
    .schema("trading")
    .from("risk_state")
    .select("equity_eur")
    .eq("executor_id", args.executorId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (rsErr) throw new Error(rsErr.message);
  const equity = Number(rs?.equity_eur ?? 0);
  if (!Number.isFinite(equity) || equity <= 0) {
    throw new Error("Add a positive EUR balance before running a historical replay.");
  }

  const win = computeHistoricalCandleWindow({ startDate: hStart, endDate: hEnd, timeframe });
  if (win.kind !== "ok") {
    throw new Error(`Invalid historical window: ${win.reason}`);
  }

  const firstReplayCloseMs = win.startOpenMs + stepMs;
  const warmupCloseFloorMs = firstReplayCloseMs - WARMUP_BARS * stepMs;
  const warmupCloseFloorIso = new Date(warmupCloseFloorMs).toISOString();
  const lastReplayCloseIso = new Date(win.endCloseMs).toISOString();

  const { data: runIns, error: runInsErr } = await admin
    .schema("trading")
    .from("executor_historical_runs")
    .insert({
      executor_id: args.executorId,
      user_id: args.userId,
      status: "running",
      bars_total: win.barCount,
      bars_done: 0,
      metadata: { marketId, marketSymbol, timeframe, warmupBars: WARMUP_BARS },
    })
    .select("id")
    .single();
  if (runInsErr) throw new Error(runInsErr.message);
  const runId = runIns?.id as string;

  try {
    const ingest = await ingestHistoricalExecutorCandles(admin, {
      marketId,
      timeframe,
      quote,
      historicalStartDate: hStart,
      historicalEndDate: hEnd,
    });

    await wipeHistoricalExecutorSimulationState(admin, {
      userId: args.userId,
      executorId: args.executorId,
      marketId,
      closeTimeGte: new Date(firstReplayCloseMs).toISOString(),
      closeTimeLte: lastReplayCloseIso,
    });

    const sortedAll = await loadCandlesThroughRange(admin, {
      marketId,
      timeframe,
      closeTimeGteIso: warmupCloseFloorIso,
      closeTimeLteIso: lastReplayCloseIso,
    });

    const replayCloses = sortedAll.filter(
      (b) => Date.parse(b.closeTimeIso) >= firstReplayCloseMs && Date.parse(b.closeTimeIso) <= win.endCloseMs,
    );
    if (replayCloses.length === 0) {
      throw new Error("No candles in database for the historical range after ingest.");
    }

    const signalUserOverride = [args.userId];
    let signalsUpsertedTotal = 0;
    let decisionsUpsertedTotal = 0;
    let ordersInsertedTotal = 0;
    let barsDone = 0;

    for (const bar of replayCloses) {
      const targetClose = bar.closeTimeIso;
      const barsThrough = sortedAll.filter((b) => Date.parse(b.closeTimeIso) <= Date.parse(targetClose) + 2);
      signalsUpsertedTotal += await upsertSignalsForMarketCloseFromBars(admin, {
        marketId,
        marketSymbol,
        timeframe,
        closeTimeIso: targetClose,
        sortedBarsAsc: barsThrough,
        signalUserIds: signalUserOverride,
        candleSyncRunId: null,
        signalsSyncRunId: null,
      });

      const med = await runMediatorCatalogCloseDrain({
        closeTimeIso: targetClose,
        timeframe,
        quote,
        onlyMarketId: marketId,
        onlyExecutorId: args.executorId,
        signalUserIdsOverride: signalUserOverride,
        disableDownstreamEnqueue: true,
      });
      decisionsUpsertedTotal += med.decisionsUpserted;

      const exo = await runExecutorCatalogCloseDrain({
        closeTimeIso: targetClose,
        timeframe,
        quote,
        onlyMarketId: marketId,
        onlyExecutorId: args.executorId,
        signalUserIdsOverride: signalUserOverride,
        disableDownstreamEnqueue: true,
      });
      ordersInsertedTotal += exo.ordersInserted;

      barsDone += 1;
      if (barsDone % 25 === 0 || barsDone === replayCloses.length) {
        await admin
          .schema("trading")
          .from("executor_historical_runs")
          .update({ bars_done: barsDone })
          .eq("id", runId);
      }
    }

    await admin
      .schema("trading")
      .from("executor_historical_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        bars_done: barsDone,
        metadata: {
          marketId,
          marketSymbol,
          timeframe,
          candleRowsUpserted: ingest.candleRowsUpserted,
          barsReplayed: barsDone,
        },
      })
      .eq("id", runId);

    return {
      ok: true,
      runId,
      barsReplayed: barsDone,
      candleRowsUpserted: ingest.candleRowsUpserted,
      signalsUpsertedTotal,
      decisionsUpsertedTotal,
      ordersInsertedTotal,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .schema("trading")
      .from("executor_historical_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: msg,
      })
      .eq("id", runId);
    throw e;
  }
}
