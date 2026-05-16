import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { getAutomatedProcessUserId } from "@/lib/automation-actor";
import {
  executorAllowsMarketAsset,
  fetchExecutorById,
  fetchExecutorsForUsers,
  fetchMarketAssetIds,
  type ExecutorRow,
} from "@/lib/agents/executor/services/executors-lookup.service";
import {
  filterSignalUserIdsToExistingAuthUsers,
  getCatalogPipelineUserIds,
} from "@/lib/agents/signal/services/signal-user-ids.service";
import { resolveLatestCatalogCandleCloseIsoForMarketTimeframe } from "@/lib/agents/signal/services/latest-catalog-close-for-signals-resolve.service";
import { runIngestRetrieveCandles } from "@/lib/agents/ingest/services/ingest-retrieve-candles.service";
import { runSignalJudgeForMarketWindow } from "@/lib/agents/signal/services/signal-judge-candle.service";
import { runTradeMediatorMakeDecision } from "@/lib/agents/trade-mediator/services/trade-mediator-make-decision.service";
import { runExecutionProcessDecision } from "@/lib/agents/executor/services/execution-process-decision.service";
import * as CandlesSelector from "@/lib/selectors/candles-selector";

export type CloseCandlePipelineArgs = {
  marketId: string;
  /**
   * ISO bar close time. Defaults to `resolveLatestCatalogCandleCloseIsoForMarketTimeframe`
   * for this market on `CATALOG_STORAGE_TIMEFRAME` (15m). When the market has no candles yet
   * the pipeline returns early with `executorsConsidered: 0`.
   */
  closeTimeIso?: string;
  /**
   * Historical run → exactly this executor (id-only lookup, ownership unchanged).
   * Omitted → all `paper`+`live` executors that allow this market's asset for the configured
   * pipeline users (typically `automated_process`).
   */
  executorId?: string;
};

export type CloseCandlePipelineResult = {
  marketId: string;
  closeTimeIso: string;
  candleRowsUpserted: number;
  barsReplayed: number;
  signalsUpsertedTotal: number;
  decisionsUpsertedTotal: number;
  ordersInsertedTotal: number;
  executorsConsidered: number;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcYmdFromIso(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error(`Invalid closeTimeIso: ${iso}`);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/**
 * Plan 2 Layer 3 orchestrator — unifies historical replay and live close-pipeline behind one
 * service. Given a market and (optional) executor / close time it runs the four domain services
 * in order: candle ingest → signal judge → trade mediator → execution.
 *
 * Live default (`executorId` omitted): processes all `paper`+`live` executors for the catalog
 * pipeline users (typically `automated_process`) that allow this market's asset.
 *
 * Historical (`executorId` supplied): one executor, regardless of execution_mode — but the
 * mediator and executor wrappers still pass through the legacy `runMediator/Executor…Drain`
 * services which already enforce mode-specific routing (paper DB writes vs live Bitvavo).
 *
 * Window resolution: from the latest known catalog candle close for this market (if any) up
 * through `closeTimeIso` — a mini-backfill for live use, a single-bar window when the catalog
 * is already current.
 */
export async function runCloseCandlePipeline(
  admin: SupabaseClient,
  args: CloseCandlePipelineArgs,
): Promise<CloseCandlePipelineResult> {
  const timeframe = CATALOG_STORAGE_TIMEFRAME;

  // Resolve target close-time. Default = latest catalog close for this market+timeframe
  // (matches the existing live symbol-close-pipeline behaviour).
  const closeTimeIso =
    args.closeTimeIso ??
    (await resolveLatestCatalogCandleCloseIsoForMarketTimeframe(admin, args.marketId, timeframe));
  if (!closeTimeIso) {
    return {
      marketId: args.marketId,
      closeTimeIso: "",
      candleRowsUpserted: 0,
      barsReplayed: 0,
      signalsUpsertedTotal: 0,
      decisionsUpsertedTotal: 0,
      ordersInsertedTotal: 0,
      executorsConsidered: 0,
    };
  }

  // Resolve executors.
  let executors: ExecutorRow[];
  if (args.executorId) {
    const lone = await fetchExecutorById(admin, args.executorId);
    executors = lone ? [lone] : [];
  } else {
    const userIds = await getCatalogPipelineUserIds(admin);
    if (userIds.length === 0) {
      executors = [];
    } else {
      const all = await fetchExecutorsForUsers(admin, userIds);
      const assetIdByMarket = await fetchMarketAssetIds(admin, [args.marketId]);
      const marketAssetId = assetIdByMarket.get(args.marketId) ?? null;
      executors = all.filter(
        (e) =>
          e.enabled &&
          (e.execution_mode === "paper" || e.execution_mode === "live") &&
          executorAllowsMarketAsset(e, marketAssetId),
      );
    }
  }

  // Resolve `signalQueryUserIds` for the mediator: prefer the automated_process user (the
  // owner of catalog-close signals); fall back to the executor owners if it can't be found.
  // Mirrors `runHistoricalExecutorReplay` which uses `[automatedUserId]`.
  const automatedUserId = await getAutomatedProcessUserId(admin);
  const fallbackOwners = [...new Set(executors.map((e) => e.user_id).filter(Boolean))];
  const signalUserIds = automatedUserId
    ? await filterSignalUserIdsToExistingAuthUsers(admin, [automatedUserId])
    : await filterSignalUserIdsToExistingAuthUsers(admin, fallbackOwners);

  // Resolve ingest window: from the latest known catalog candle close → closeTimeIso.
  // If the catalog has no rows for this market the window degenerates to the same day
  // as `closeTimeIso` (single-day backfill on the storage timeframe).
  const endDate = utcYmdFromIso(closeTimeIso);
  let startDate = endDate;
  const latest = await CandlesSelector.selectIdTimeframeCloseForMarketLatest(admin, {
    marketId: args.marketId,
    limit: 1,
  });
  const latestRow = latest[0];
  const latestTs = Array.isArray(latestRow?.candle_timestamps)
    ? latestRow?.candle_timestamps[0]
    : latestRow?.candle_timestamps;
  const lastKnownCloseIso = latestTs?.close_time ?? null;
  if (lastKnownCloseIso) {
    const candidate = utcYmdFromIso(lastKnownCloseIso);
    if (ISO_DATE_RE.test(candidate) && candidate <= endDate) {
      startDate = candidate;
    }
  }

  // 1. Ingest candles.
  const ingest = await runIngestRetrieveCandles(admin, {
    marketId: args.marketId,
    startDate,
    endDate,
  });

  // 2. Signal judge for the window. Skipped when no signal users are configured (otherwise
  // the underlying upsert path would write rows without an owner).
  let signalsUpsertedTotal = 0;
  let barsReplayed = 0;
  if (signalUserIds.length > 0) {
    const judge = await runSignalJudgeForMarketWindow(admin, {
      marketId: args.marketId,
      startDate,
      endDate,
      signalUserIds,
    });
    signalsUpsertedTotal = judge.signalsUpsertedTotal;
    barsReplayed = judge.barsReplayed;
  }

  // 3 + 4. Per executor: mediator → executor for the close bar.
  let decisionsUpsertedTotal = 0;
  let ordersInsertedTotal = 0;
  for (const ex of executors) {
    const med = await runTradeMediatorMakeDecision(admin, {
      closeTimeIso,
      marketId: args.marketId,
      executorId: ex.id,
      timeframe,
      signalQueryUserIds: signalUserIds,
    });
    decisionsUpsertedTotal += med.decisionsUpserted;

    const exo = await runExecutionProcessDecision(admin, {
      closeTimeIso,
      marketId: args.marketId,
      executorId: ex.id,
      timeframe,
    });
    ordersInsertedTotal += exo.ordersInserted;
  }

  return {
    marketId: args.marketId,
    closeTimeIso,
    candleRowsUpserted: ingest.candleRowsUpserted,
    barsReplayed,
    signalsUpsertedTotal,
    decisionsUpsertedTotal,
    ordersInsertedTotal,
    executorsConsidered: executors.length,
  };
}
