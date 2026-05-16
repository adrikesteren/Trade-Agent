import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutomatedProcessUserId } from "@/lib/automation-actor";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { fetchWalletBalanceForAsset } from "@/lib/agents/executor/services/executor-wallet.service";
import { fetchHistoricalExecutorPaperMarket } from "@/lib/agents/executor/services/historical-paper-market.service";
import { runExecutorCatalogCloseDrain } from "@/lib/agents/executor/services/catalog-close-executor-run.service";
import { runMediatorCatalogCloseDrain } from "@/lib/agents/trade-mediator/services/catalog-close-mediator-run.service";
import { fetchExchangeIdByCode } from "@/lib/agents/executor/services/executors-lookup.service";
import * as ExecutorHistoricalRunsSelector from "@/lib/selectors/executor-historical-runs-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";

import { replaySignalsForBars } from "@/lib/agents/signal/services/replay-signals-for-bars.service";

import { computeHistoricalCandleWindow } from "@/lib/agents/ingest/services/historical-candle-window.service";
import { ingestHistoricalCandles } from "@/lib/agents/ingest/services/historical-candles-ingest.service";
import {
  HISTORICAL_REPLAY_WARMUP_BARS,
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

  const ex = await ExecutorsSelector.selectHistoricalReplayByIdAndUser(admin, {
    id: args.executorId,
    userId: args.userId,
  });
  if (!ex) throw new Error("Executor not found.");
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
  const baseBalance = await fetchWalletBalanceForAsset(admin, { executorId: args.executorId, assetId: baseAssetId });
  if (!Number.isFinite(baseBalance) || baseBalance <= 0) {
    throw new Error(
      "Add a positive wallet balance for the whitelisted base asset (same asset as the single filter) before running a historical replay.",
    );
  }
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
  const { marketId, marketSymbol } = paper;

  const win = computeHistoricalCandleWindow({ startDate: hStart, endDate: hEnd, timeframe });
  if (win.kind !== "ok") {
    throw new Error(`Invalid historical window: ${win.reason}`);
  }

  const runId = await ExecutorHistoricalRunsSelector.insertRunningReturningId(admin, {
    executor_id: args.executorId,
    user_id: args.userId,
    status: "running",
    bars_total: win.barCount,
    bars_done: 0,
    metadata: { marketId, marketSymbol, timeframe, warmupBars: HISTORICAL_REPLAY_WARMUP_BARS },
  });

  try {
    const ingest = await ingestHistoricalCandles(admin, {
      marketId,
      timeframe,
      quote,
      historicalStartDate: hStart,
      historicalEndDate: hEnd,
    });

    const loaded = await loadHistoricalCandlesForReplay(admin, {
      marketId,
      timeframe,
      historicalStartDate: hStart,
      historicalEndDate: hEnd,
    });

    const signalUserIds = [automatedUserId];
    let decisionsUpsertedTotal = 0;
    let ordersInsertedTotal = 0;

    const { barsReplayed, signalsUpsertedTotal } = await replaySignalsForBars(admin, {
      marketId,
      marketSymbol,
      timeframe,
      sortedAll: loaded.sortedAll,
      replayCloses: loaded.replayCloses,
      signalUserIds,
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
          await ExecutorHistoricalRunsSelector.updateBarsDoneById(admin, {
            id: runId,
            barsDone,
          });
        }
      },
    });

    await ExecutorHistoricalRunsSelector.updateCompletedById(admin, {
      id: runId,
      barsDone: barsReplayed,
      metadata: {
        marketId,
        marketSymbol,
        timeframe,
        candleRowsUpserted: ingest.candleRowsUpserted,
        barsReplayed,
      },
    });

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
    await ExecutorHistoricalRunsSelector.updateFailedById(admin, {
      id: runId,
      error: msg,
    });
    throw e;
  }
}
