import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  beginBitvavoSyncRun,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  SYMBOL_CLOSE_PIPELINE_JOB_KEY,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  ResolvePrimaryMarketError,
  resolvePrimaryMarketByCodes,
} from "@/lib/markets/resolve-primary-market-by-codes";
import {
  buildCoingeckoIdMapForAssetIds,
  syncCoingeckoAssetMetricsMarketsPhase,
} from "@/lib/markets/sync-coingecko-metrics";
import { sweepBitvavoSingleMarketCatalogCandles } from "@/lib/markets/sweep-bitvavo-single-market-catalog-candles";
import { runExecutorCatalogCloseDrain } from "@/lib/executor/run-executor-catalog-close";
import { runMediatorCatalogCloseDrain } from "@/lib/mediator/run-mediator-catalog-close";
import { resolveLatestCatalogCandleCloseIso } from "@/lib/signals/resolve-latest-catalog-close-for-signals";
import { runSignalsCatalogCloseDrain } from "@/lib/signals/run-signals-catalog-close";
import { acquireLock, createRedis, releaseLock, type LockHandle } from "@repo/redis";

export type SymbolClosePipelineOptions = {
  assetCode: string;
  exchangeCode: string;
  /** Default EUR */
  quote?: string;
  skipCoingecko?: boolean;
  skipCandles?: boolean;
  skipSignals?: boolean;
  skipMediator?: boolean;
  skipExecutor?: boolean;
};

export type SymbolClosePipelineStepOk = { ok: true } & Record<string, unknown>;
export type SymbolClosePipelineStepErr = { ok: false; code: string; message: string };
export type SymbolClosePipelineStepResult = SymbolClosePipelineStepOk | SymbolClosePipelineStepErr;

function okStep(detail?: Record<string, unknown>): SymbolClosePipelineStepOk {
  return { ok: true, ...detail };
}

function errStep(code: string, message: string): SymbolClosePipelineStepErr {
  return { ok: false, code, message };
}

export type RunSymbolClosePipelineResult = {
  ok: boolean;
  syncRunId: string | null;
  resolved: {
    marketId: string;
    marketSymbol: string;
    assetId: string;
    assetCode: string;
    exchangeCode: string;
    quoteCode: string;
  };
  steps: {
    coingecko: SymbolClosePipelineStepResult;
    candles: SymbolClosePipelineStepResult;
    closeTime: SymbolClosePipelineStepResult;
    signals: SymbolClosePipelineStepResult;
    mediator: SymbolClosePipelineStepResult;
    executor: SymbolClosePipelineStepResult;
  };
  error?: string;
};

export async function runSymbolClosePipeline(
  admin: SupabaseClient,
  opts: SymbolClosePipelineOptions,
): Promise<RunSymbolClosePipelineResult> {
  let resolved;
  try {
    resolved = await resolvePrimaryMarketByCodes(admin, {
      assetCode: opts.assetCode,
      exchangeCode: opts.exchangeCode,
      quote: opts.quote,
    });
  } catch (e) {
    if (e instanceof ResolvePrimaryMarketError) {
      return {
        ok: false,
        syncRunId: null,
        resolved: {
          marketId: "",
          marketSymbol: "",
          assetId: "",
          assetCode: opts.assetCode.trim(),
          exchangeCode: opts.exchangeCode.trim(),
          quoteCode: (opts.quote ?? "EUR").trim().toUpperCase() || "EUR",
        },
        steps: {
          coingecko: errStep(e.code, e.message),
          candles: errStep("skipped", "resolve failed"),
          closeTime: errStep("skipped", "resolve failed"),
          signals: errStep("skipped", "resolve failed"),
          mediator: errStep("skipped", "resolve failed"),
          executor: errStep("skipped", "resolve failed"),
        },
        error: e.message,
      };
    }
    throw e;
  }

  const resolvedOut = {
    marketId: resolved.marketId,
    marketSymbol: resolved.marketSymbol,
    assetId: resolved.assetId,
    assetCode: resolved.assetCode,
    exchangeCode: resolved.exchangeCode,
    quoteCode: resolved.quoteCode,
  };

  const redisEnabled = process.env.SYMBOL_CLOSE_PIPELINE_REDIS_LOCK === "1";
  const redis = redisEnabled ? createRedis() : null;
  let lockHandle: LockHandle | null = null;
  if (redis) {
    lockHandle = await acquireLock(
      redis,
      `symbol-close:${resolved.exchangeCode}:${resolved.assetCode}`,
      180_000,
    );
    if (!lockHandle) {
      return {
        ok: false,
        syncRunId: null,
        resolved: resolvedOut,
        steps: {
          coingecko: errStep("lock_not_acquired", "Another run holds the Redis lock for this exchange/asset."),
          candles: errStep("skipped", "redis lock not acquired"),
          closeTime: errStep("skipped", "redis lock not acquired"),
          signals: errStep("skipped", "redis lock not acquired"),
          mediator: errStep("skipped", "redis lock not acquired"),
          executor: errStep("skipped", "redis lock not acquired"),
        },
        error: "lock_not_acquired",
      };
    }
  }

  try {
  let begun: Awaited<ReturnType<typeof beginBitvavoSyncRun>>;
  try {
    begun = await beginBitvavoSyncRun(admin, SYMBOL_CLOSE_PIPELINE_JOB_KEY, "manual", {
      metadata: {
        assetCode: resolved.assetCode,
        exchangeCode: resolved.exchangeCode,
        marketId: resolved.marketId,
        marketSymbol: resolved.marketSymbol,
        quote: resolved.quoteCode,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      syncRunId: null,
      resolved: resolvedOut,
      steps: {
        coingecko: errStep("sync_run_not_started", msg),
        candles: errStep("skipped", "sync run not started"),
        closeTime: errStep("skipped", "sync run not started"),
        signals: errStep("skipped", "sync run not started"),
        mediator: errStep("skipped", "sync run not started"),
        executor: errStep("skipped", "sync run not started"),
      },
      error: msg,
    };
  }

  if (begun.outcome === "skipped") {
    return {
      ok: false,
      syncRunId: begun.runId,
      resolved: resolvedOut,
      steps: {
        coingecko: errStep("skipped_overlap", "Another symbol_close_pipeline run is already in progress for this asset/exchange."),
        candles: errStep("skipped", "sync run not started"),
        closeTime: errStep("skipped", "sync run not started"),
        signals: errStep("skipped", "sync run not started"),
        mediator: errStep("skipped", "sync run not started"),
        executor: errStep("skipped", "sync run not started"),
      },
      error: "skipped_overlap",
    };
  }

  const runId = begun.runId;
  const steps: RunSymbolClosePipelineResult["steps"] = {
    coingecko: errStep("pending", ""),
    candles: errStep("pending", ""),
    closeTime: errStep("pending", ""),
    signals: errStep("pending", ""),
    mediator: errStep("pending", ""),
    executor: errStep("pending", ""),
  };

  const isBitvavo = resolved.exchangeCode.toLowerCase() === "bitvavo";

  try {
    if (!opts.skipCoingecko) {
      try {
        const { idByCoingecko, stillMissingCoingeckoId } = await buildCoingeckoIdMapForAssetIds(admin, [resolved.assetId]);
        if (idByCoingecko.size === 0) {
          steps.coingecko = okStep({ assetsUpdated: 0, stillMissingCoingeckoId });
        } else {
          const { assetsUpdated } = await syncCoingeckoAssetMetricsMarketsPhase(admin, idByCoingecko);
          steps.coingecko = okStep({ assetsUpdated, stillMissingCoingeckoId });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.coingecko = errStep("coingecko_failed", msg);
        throw e;
      }
    } else {
      steps.coingecko = okStep({ skipped: true });
    }

    if (!opts.skipCandles) {
      if (!isBitvavo) {
        steps.candles = errStep("unsupported_exchange_for_candles", `Candles not implemented for exchange: ${resolved.exchangeCode}`);
      } else {
        try {
          const { candleRowsUpserted, marketSymbol } = await sweepBitvavoSingleMarketCatalogCandles(admin, resolved.marketId);
          steps.candles = okStep({ candleRowsUpserted, marketSymbol });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          steps.candles = errStep("candles_failed", msg);
          throw e;
        }
      }
    } else {
      steps.candles = okStep({ skipped: true });
    }

    let closeTimeIso: string | null = null;
    if (!opts.skipSignals || !opts.skipMediator || !opts.skipExecutor) {
      if (!isBitvavo) {
        steps.closeTime = errStep("unsupported_exchange_for_trading", "Signals/mediator/executor catalog-close is Bitvavo-only in this pipeline.");
        steps.signals = errStep("skipped", "unsupported exchange");
        steps.mediator = errStep("skipped", "unsupported exchange");
        steps.executor = errStep("skipped", "unsupported exchange");
      } else {
        closeTimeIso = await resolveLatestCatalogCandleCloseIso(admin);
        if (!closeTimeIso) {
          steps.closeTime = errStep("no_catalog_close_time", "No rows in catalog.candle_timestamps; run candle sync first.");
          steps.signals = errStep("skipped", "no close time");
          steps.mediator = errStep("skipped", "no close time");
          steps.executor = errStep("skipped", "no close time");
        } else {
          steps.closeTime = okStep({ closeTimeIso });

          const scoped = {
            closeTimeIso,
            timeframe: CATALOG_STORAGE_TIMEFRAME,
            quote: resolved.quoteCode,
            onlyMarketId: resolved.marketId,
            disableDownstreamEnqueue: true,
            marketOffset: 0,
          };

          if (!opts.skipSignals) {
            try {
              const sig = await runSignalsCatalogCloseDrain(scoped);
              steps.signals = okStep({
                marketsProcessed: sig.marketsProcessed,
                signalsUpserted: sig.signalsUpserted,
                skippedReason: sig.skippedReason,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              steps.signals = errStep("signals_failed", msg);
              throw e;
            }
          } else {
            steps.signals = okStep({ skipped: true });
          }

          if (!opts.skipMediator) {
            try {
              const med = await runMediatorCatalogCloseDrain({
                ...scoped,
                signalsSyncRunId: null,
                candleSyncRunId: null,
                mediatorPipelineSyncRunId: null,
              });
              steps.mediator = okStep({
                marketsProcessed: med.marketsProcessed,
                decisionsUpserted: med.decisionsUpserted,
                skippedReason: med.skippedReason,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              steps.mediator = errStep("mediator_failed", msg);
              throw e;
            }
          } else {
            steps.mediator = okStep({ skipped: true });
          }

          if (!opts.skipExecutor) {
            try {
              const ex = await runExecutorCatalogCloseDrain({
                ...scoped,
                signalsSyncRunId: null,
                candleSyncRunId: null,
                mediatorSyncRunId: null,
                executorPipelineSyncRunId: null,
                disableDownstreamEnqueue: true,
              });
              steps.executor = okStep({
                marketsProcessed: ex.marketsProcessed,
                ordersInserted: ex.ordersInserted,
                skippedReason: ex.skippedReason,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              steps.executor = errStep("executor_failed", msg);
              throw e;
            }
          } else {
            steps.executor = okStep({ skipped: true });
          }
        }
      }
    } else {
      steps.closeTime = okStep({ skipped: true });
      steps.signals = okStep({ skipped: true });
      steps.mediator = okStep({ skipped: true });
      steps.executor = okStep({ skipped: true });
    }

    const tradingRequested = !opts.skipSignals || !opts.skipMediator || !opts.skipExecutor;
    const closeTimeFailed =
      !steps.closeTime.ok && steps.closeTime.code === "no_catalog_close_time";
    if (isBitvavo && tradingRequested && !opts.skipSignals && closeTimeFailed) {
      const failMsg = steps.closeTime.ok === false ? String(steps.closeTime.message) : "no_catalog_close_time";
      await recordBitvavoSyncFailed(admin, {
        runId,
        jobKey: SYMBOL_CLOSE_PIPELINE_JOB_KEY,
        source: "manual",
        reason: failMsg,
        metadata: { resolved: resolvedOut as unknown as Record<string, unknown>, steps: steps as unknown as Record<string, unknown> },
      });
      return {
        ok: false,
        syncRunId: runId,
        resolved: resolvedOut,
        steps,
        error: failMsg,
      };
    }

    await recordBitvavoSyncCompleted(admin, {
      runId,
      jobKey: SYMBOL_CLOSE_PIPELINE_JOB_KEY,
      source: "manual",
      metadata: {
        resolved: resolvedOut as unknown as Record<string, unknown>,
        steps: steps as unknown as Record<string, unknown>,
      },
    });

    return {
      ok: true,
      syncRunId: runId,
      resolved: resolvedOut,
      steps,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordBitvavoSyncFailed(admin, {
      runId,
      jobKey: SYMBOL_CLOSE_PIPELINE_JOB_KEY,
      source: "manual",
      reason: msg,
      metadata: {
        resolved: resolvedOut as unknown as Record<string, unknown>,
        steps: steps as unknown as Record<string, unknown>,
      },
    });
    return {
      ok: false,
      syncRunId: runId,
      resolved: resolvedOut,
      steps,
      error: msg,
    };
  }
  } finally {
    if (redis && lockHandle) {
      await releaseLock(redis, lockHandle);
    }
  }
}
