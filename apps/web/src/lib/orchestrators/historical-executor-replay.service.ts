import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutomatedProcessUserId } from "@/lib/automation-actor";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { fetchWalletBalanceForAsset } from "@/lib/agents/executor/services/executor-wallet.service";
import { fetchHistoricalExecutorPaperMarket } from "@/lib/agents/executor/services/historical-paper-market.service";
import { runExecutorCatalogCloseDrain } from "@/lib/agents/executor/services/catalog-close-executor-run.service";
import { runMediatorCatalogCloseDrain } from "@/lib/agents/trade-mediator/services/catalog-close-mediator-run.service";
import { fetchExchangeIdByCode } from "@/lib/agents/executor/services/executors-lookup.service";

import { fetchEnabledSignalAgents } from "@/lib/agents/signal/services/enabled-signal-agents-fetch.service";
import { replaySignalsForBars } from "@/lib/agents/signal/services/replay-signals-for-bars.service";

import { computeHistoricalCandleWindow } from "@/lib/agents/ingest/services/historical-candle-window.service";
import { ingestHistoricalCandles } from "@/lib/agents/ingest/services/historical-candles-ingest.service";
import {
  computeWarmupBars,
  loadHistoricalCandlesForReplay,
} from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

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
  const baseAssetId = assetIds[0]!;
  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(ex.exchange_id) !== bitvavoId) {
    throw new Error("Historical replay requires a Bitvavo executor exchange.");
  }

  const automatedUserId = await getAutomatedProcessUserId(admin);
  if (!automatedUserId) {
    throw new Error(
      "Historical replay requires the automated_process user (automation_actor or user_profiles.username = automated_process).",
    );
  }

  const paper = await fetchHistoricalExecutorPaperMarket(admin, {
    executorExchangeId: String(ex.exchange_id),
    filterBaseAssetId: baseAssetId,
  });
  if (!paper) {
    throw new Error("No Bitvavo EUR market found for the selected asset.");
  }
  const { marketId, marketSymbol, quoteAssetId } = paper;

  // Long-only spot replay spends the market QUOTE (e.g. EUR for GIGA-EUR), not the base.
  // Gate the run on a positive quote balance; the base is acquired by the simulated buys.
  const quoteBalance = await fetchWalletBalanceForAsset(admin, {
    executorId: args.executorId,
    assetId: quoteAssetId,
  });
  if (!Number.isFinite(quoteBalance) || quoteBalance <= 0) {
    throw new Error(
      `Add a positive wallet balance for the market quote asset (${marketSymbol.split("-")[1] ?? "quote"}) before running a historical replay.`,
    );
  }

  const win = computeHistoricalCandleWindow({ startDate: hStart, endDate: hEnd, timeframe });
  if (win.kind !== "ok") {
    throw new Error(`Invalid historical window: ${win.reason}`);
  }

  // P3: derive warmup from the agents that are actually enabled — the regime
  // classifier reads `maPeriod × trendTimeframeMinutes` from its config
  // (default seed 4h × 200 → 33 days), multi-tf confluence reads 4h × `trendMa`.
  // `signal_agents` is a global catalog (not per-user); the helper centralises
  // the "enabled + timeframe-applicable" filter so the same set is used for
  // warmup, ingest, and signal coverage.
  const enabledAgents = await fetchEnabledSignalAgents(admin, { timeframe });
  const enabledAgentSlugs = enabledAgents.map((a) => a.slug);
  const warmupBars = computeWarmupBars(timeframe, enabledAgents);

  const { data: runIns, error: runInsErr } = await admin
    .schema("trading")
    .from("executor_historical_runs")
    .insert({
      executor_id: args.executorId,
      user_id: args.userId,
      status: "running",
      bars_total: win.barCount,
      bars_done: 0,
      metadata: { marketId, marketSymbol, timeframe, warmupBars, enabledAgentSlugs },
    })
    .select("id")
    .single();
  if (runInsErr) throw new Error(runInsErr.message);
  const runId = runIns?.id as string;

  try {
    const ingest = await ingestHistoricalCandles(admin, {
      marketId,
      timeframe,
      quote,
      historicalStartDate: hStart,
      historicalEndDate: hEnd,
      enabledAgents,
    });

    const loaded = await loadHistoricalCandlesForReplay(admin, {
      marketId,
      timeframe,
      historicalStartDate: hStart,
      historicalEndDate: hEnd,
      warmupBars,
    });

    const signalUserIds = [automatedUserId];
    let decisionsUpsertedTotal = 0;
    let ordersInsertedTotal = 0;

    const {
      barsReplayed,
      signalsUpsertedTotal,
      barsReusedFromExistingSignals,
      barsPartiallyReused,
    } = await replaySignalsForBars(admin, {
      marketId,
      marketSymbol,
      timeframe,
      sortedAll: loaded.sortedAll,
      replayCloses: loaded.replayCloses,
      signalUserIds,
      // Re-use any `(agent, candle)` signal that already exists for the automation
      // user from an earlier replay or the evaluate-all-signals worker. Fully-covered
      // bars skip the Signal Agent eval entirely (mediator still runs and reads them).
      reuseExistingSignals: true,
      onBarComplete: async ({ bar, barsDone, barsTotal }) => {
        const targetClose = bar.closeTimeIso;

        const med = await runMediatorCatalogCloseDrain({
          closeTimeIso: targetClose,
          timeframe,
          quote,
          onlyMarketId: marketId,
          onlyExecutorId: args.executorId,
          signalQueryUserIds: signalUserIds,
          disableDownstreamEnqueue: true,
          historicalReplayScaleInEnter: true,
        });
        decisionsUpsertedTotal += med.decisionsUpserted;

        const exo = await runExecutorCatalogCloseDrain({
          closeTimeIso: targetClose,
          timeframe,
          quote,
          onlyMarketId: marketId,
          onlyExecutorId: args.executorId,
          disableDownstreamEnqueue: true,
        });
        ordersInsertedTotal += exo.ordersInserted;

        if (barsDone % 25 === 0 || barsDone === barsTotal) {
          await admin
            .schema("trading")
            .from("executor_historical_runs")
            .update({ bars_done: barsDone })
            .eq("id", runId);
        }
      },
    });

    await admin
      .schema("trading")
      .from("executor_historical_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        bars_done: barsReplayed,
        metadata: {
          marketId,
          marketSymbol,
          timeframe,
          candleRowsUpserted: ingest.candleRowsUpserted,
          barsReplayed,
          warmupBars,
          enabledAgentSlugs,
          // Ingest cache: when `true`, the Bitvavo HTTP fetch was skipped because
          // every bar in the warmup+replay window was already in `catalog.candles`.
          ingestCached: ingest.cached,
          ingestCandlesAlreadyInDb: ingest.candlesAlreadyInDb,
          ingestBarCount: ingest.ingestBarCount,
          // Signal reuse: bars whose `(agent, candle)` coverage was already fully /
          // partially populated for the automation user, so the Signal Agent eval
          // was skipped or restricted to the missing agents only.
          barsReusedFromExistingSignals,
          barsPartiallyReused,
          // Ingest coverage + soft warnings so the user can see "we forward-
          // filled 4321 synthetic bars because Bitvavo had no trades there"
          // without re-running anything. Surfaces sparse-market issues
          // (e.g. GIGA-EUR) without aborting the run.
          ingestCoverage: loaded.coverage,
          ingestWarnings: loaded.warnings,
        },
      })
      .eq("id", runId);

    return {
      ok: true,
      runId,
      barsReplayed,
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
