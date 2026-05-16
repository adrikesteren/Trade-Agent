import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as DecisionsSelector from "@/lib/selectors/decisions-selector";
import * as PositionsSelector from "@/lib/selectors/positions-selector";
import * as SignalAgentsSelector from "@/lib/selectors/signal-agents-selector";
import * as SignalsSelector from "@/lib/selectors/signals-selector";

import { detectRegimeFlip, type RegimePoint, type RegimeLabel } from "./regime-flip-detect.service";
import { emitSarDecisions, type PositionSide, type SarOpenPosition } from "./sar-decision-emit.service";

/**
 * Resolve a regime label from a signal row's `metadata` blob. Returns `null`
 * for missing / unknown regimes (treated as no SAR action).
 */
function readRegime(metadata: Record<string, unknown> | null | undefined): RegimeLabel | null {
  if (!metadata || typeof metadata !== "object") return null;
  const r = (metadata as Record<string, unknown>).regime;
  if (r === "bull" || r === "bear" || r === "sideways") return r;
  return null;
}

const REGIME_AGENT_SLUG = "regime-classifier-15m-v1";

/**
 * Fetch the last `limit` regime classifier signals **before** the current bar
 * for one (user, market) pair, ordered by close time descending. Caller is
 * responsible for reversing to ASC if needed.
 */
async function fetchPreviousRegimeSignals(
  admin: SupabaseClient,
  args: { userId: string; marketId: string; beforeCloseTimeIso: string; limit: number },
): Promise<RegimePoint[]> {
  // Lookup signal_agents.id for the regime classifier agent.
  let signalAgentId: string | null = null;
  try {
    signalAgentId = await SignalAgentsSelector.selectIdByAgentSlug(admin, REGIME_AGENT_SLUG);
  } catch {
    return [];
  }
  if (!signalAgentId) return [];

  let rows: Awaited<ReturnType<typeof SignalsSelector.selectRegimeSignalsBeforeCloseTime>>;
  try {
    rows = await SignalsSelector.selectRegimeSignalsBeforeCloseTime(admin, {
      userId: args.userId,
      signalAgentId,
      marketId: args.marketId,
      beforeCloseTimeIso: args.beforeCloseTimeIso,
      limit: args.limit,
    });
  } catch {
    return [];
  }

  const points: RegimePoint[] = [];
  for (const r of rows) {
    const candle = Array.isArray(r.candles) ? r.candles[0] : r.candles;
    const ts = Array.isArray(candle?.candle_timestamps) ? candle?.candle_timestamps?.[0] : candle?.candle_timestamps;
    const closeTimeIso = String(ts?.close_time ?? "").trim();
    const regime = readRegime(r.metadata);
    if (!closeTimeIso || !regime) continue;
    points.push({ closeTimeIso, regime });
  }
  return points;
}

/**
 * Fetch open positions for one (user, executor, market) keyed by side.
 */
async function fetchOpenPositionsBySide(
  admin: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<SarOpenPosition[]> {
  const rows = await PositionsSelector.selectSideAndQuantityByTrio(admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
  });
  const out: SarOpenPosition[] = [];
  for (const r of rows) {
    const qty = Number(r.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const side = r.position_side === "short" ? "short" : "long";
    out.push({ side, quantity: qty });
  }
  return out;
}

export type EvaluateAndEmitSarArgs = {
  admin: SupabaseClient;
  userId: string;
  executorId: string;
  executorName: string;
  exchangeId: string;
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  closeTimeIso: string;
  /** The regime classifier signal row matched for this bar (id + metadata.regime). */
  regimeSignalId: string;
  regimeSignalMetadata: Record<string, unknown> | null;
  /** Allowed sides for this executor (P2). */
  allowedSides: PositionSide[];
  /** Notional in quote units to stamp on the SAR ENTER (already converted by P1 helper). */
  notionalQuoteForEnter: number | null;
  /** Audit ids forwarded into decision_payload. */
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  mediatorPipelineSyncRunId?: string | null;
  /** Risk snapshot to attach to the SAR decisions. */
  riskSnapshot: Record<string, unknown>;
};

export type EvaluateAndEmitSarResult = {
  decisionsUpserted: number;
  flipped: boolean;
  fromRegime: RegimeLabel | null;
  toRegime: RegimeLabel | null;
};

/**
 * Mediator entry point for SAR (Stop-and-Reverse). Side-effecting: when a
 * regime flip is confirmed, this writes 0-2 paired decisions in
 * `trading.decisions` keyed on the regime classifier `signal_id` with
 * different `position_side` values (allowed by P3/M10 widened uniqueness).
 *
 * Always returns; never throws on no-op (no flip → returns 0 decisions).
 */
export async function evaluateAndEmitSar(args: EvaluateAndEmitSarArgs): Promise<EvaluateAndEmitSarResult> {
  const noop: EvaluateAndEmitSarResult = { decisionsUpserted: 0, flipped: false, fromRegime: null, toRegime: null };
  const tRegime = readRegime(args.regimeSignalMetadata);
  if (!tRegime) return noop;

  const previous = await fetchPreviousRegimeSignals(args.admin, {
    userId: args.userId,
    marketId: args.marketId,
    beforeCloseTimeIso: args.closeTimeIso,
    limit: 2,
  });

  // Build [t-2, t-1, t] in ascending close-time order. `previous` is DESC.
  const ascending: RegimePoint[] = [...previous].reverse();
  ascending.push({ closeTimeIso: args.closeTimeIso, regime: tRegime });

  const flip = detectRegimeFlip(ascending);
  if (!flip.flipped) {
    return { ...noop, flipped: false };
  }

  const openPositions = await fetchOpenPositionsBySide(args.admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
  });

  const sar = emitSarDecisions({
    flip,
    allowedSides: args.allowedSides,
    openPositions,
    notionalQuoteForEnter: args.notionalQuoteForEnter ?? null,
  });
  if (!sar.proposals.length) {
    return { decisionsUpserted: 0, flipped: true, fromRegime: flip.fromRegime, toRegime: flip.toRegime };
  }

  let written = 0;
  for (const proposal of sar.proposals) {
    const proposedOrder =
      proposal.intent === "EXIT"
        ? {
            side: proposal.side,
            positionSide: proposal.positionSide,
            quantity: proposal.quantity,
            sarReason: proposal.reason,
          }
        : {
            side: proposal.side,
            positionSide: proposal.positionSide,
            notionalEur: proposal.notionalQuote ?? null,
            sarReason: proposal.reason,
          };

    const sarRow = {
      user_id: args.userId,
      executor_id: args.executorId,
      timeframe: args.timeframe,
      signal_id: args.regimeSignalId,
      approved: true,
      reason_codes: [proposal.reason],
      risk_snapshot: args.riskSnapshot,
      position_side: proposal.positionSide,
      decision_payload: {
        resolvedIntent: proposal.intent,
        policyVersion: "v1-sar",
        signalIds: [args.regimeSignalId],
        signalsIn: [{ id: args.regimeSignalId, intent: "HOLD", agent_id: REGIME_AGENT_SLUG }],
        proposedOrder,
        market_symbol: args.marketSymbol,
        executorId: args.executorId,
        executorName: args.executorName,
        exchangeId: args.exchangeId,
        movingFloor: null,
        barCloseTimeIso: args.closeTimeIso,
        positionSide: proposal.positionSide,
        sarFlip: {
          fromRegime: flip.fromRegime,
          toRegime: flip.toRegime,
          confirmedAtBar: flip.confirmedAtBar,
        },
        ...(args.candleSyncRunId ? { candleSyncRunId: args.candleSyncRunId } : {}),
        ...(args.signalsSyncRunId ? { signalsSyncRunId: args.signalsSyncRunId } : {}),
        ...(args.mediatorPipelineSyncRunId ? { mediatorSyncRunId: args.mediatorPipelineSyncRunId } : {}),
      },
    };

    try {
      await DecisionsSelector.upsertOneByExecutorSignalSide(args.admin, sarRow);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[mediator/sar] ${args.marketSymbol} ${args.executorName} ${proposal.intent} ${proposal.positionSide}: ${msg}`,
      );
      continue;
    }
    written += 1;
  }

  return {
    decisionsUpserted: written,
    flipped: true,
    fromRegime: flip.fromRegime,
    toRegime: flip.toRegime,
  };
}
