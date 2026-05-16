import "server-only";

import {
  beginBitvavoSyncRun,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  SYNC_JOB_MARKET_EVALUATE_ALL_SIGNALS,
  type BitvavoSyncTriggerSource,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import {
  runMarketEvaluateAllSignals,
  type RunMarketEvaluateAllSignalsArgs,
  type RunMarketEvaluateAllSignalsResult,
} from "./market-evaluate-all-signals.service";

export type ExecuteMarketEvaluateAllSignalsOutcome =
  | { kind: "skipped_overlap"; runId: string }
  | { kind: "completed"; runId: string; result: RunMarketEvaluateAllSignalsResult };

/**
 * One `automation.sync_runs` row for `market_evaluate_all_signals`, then drains
 * `runMarketEvaluateAllSignals` (skip-existing across all stored 15m candles for the market).
 * On concurrent automated overlap, returns `skipped_overlap` without running work.
 *
 * Manual callers (the header button) propagate `beginBitvavoSyncRun` errors so the
 * UI can surface "Another sync is already running for this job."
 */
export async function executeMarketEvaluateAllSignalsWithSyncRun(
  args: RunMarketEvaluateAllSignalsArgs,
  source: BitvavoSyncTriggerSource,
): Promise<ExecuteMarketEvaluateAllSignalsOutcome> {
  const admin = createServiceRoleClient();
  const forceAgentSlugs = args.forceAgentSlugs ?? [];
  const begun = await beginBitvavoSyncRun(admin, SYNC_JOB_MARKET_EVALUATE_ALL_SIGNALS, source, {
    metadata: { marketId: args.marketId, forceAgentSlugs },
  });
  if (begun.outcome === "skipped") {
    return { kind: "skipped_overlap", runId: begun.runId };
  }
  const runId = begun.runId;
  try {
    const result = await runMarketEvaluateAllSignals(admin, { ...args, signalsSyncRunId: runId });
    await recordBitvavoSyncCompleted(admin, {
      runId,
      jobKey: SYNC_JOB_MARKET_EVALUATE_ALL_SIGNALS,
      source,
      metadata: {
        marketId: args.marketId,
        marketSymbol: result.marketSymbol,
        candleTotal: result.candleTotal,
        barsProcessed: result.barsProcessed,
        signalsUpserted: result.signalsUpserted,
        deadlineHit: result.deadlineHit,
        agentCount: result.agentCount,
        forceAgentSlugs,
      },
    });
    return { kind: "completed", runId, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordBitvavoSyncFailed(admin, {
      runId,
      jobKey: SYNC_JOB_MARKET_EVALUATE_ALL_SIGNALS,
      source,
      reason: msg,
      metadata: { marketId: args.marketId, forceAgentSlugs },
    });
    throw e;
  }
}
