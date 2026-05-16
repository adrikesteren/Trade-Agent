import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as SignalAgentsSelector from "@/lib/selectors/signal-agents-selector";
import { closeTimesMatch } from "@/lib/trading/close-time-match";

import { evaluateMaCrossAtClose, type MaCrossBar } from "./ma-cross-eval.service";
import { evaluateRsiReversionAtClose } from "./rsi-reversion-eval.service";
import { evaluateBreakoutAtrAtClose } from "./breakout-atr-eval.service";
import { filterSignalUserIdsToExistingAuthUsers } from "./signal-user-ids.service";

type SortedBar = {
  id: string;
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
  /** Optional — only some upstream callers carry volume today. */
  volume?: number;
};

/**
 * P3: parse a "min/max ATR pct" entry from `signal_agents.config` JSON.
 * Accepts numbers; returns null for missing / non-finite values so the
 * eval services treat the bound as not-configured (no-op gate).
 */
function parseGateNumber(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

/**
 * Upserts `trading.signals` for one catalog close using preloaded ascending bars (same agents as catalog-close).
 *
 * When `agentIdFilter` is given, only agents whose row id is in that set are evaluated — used by the
 * "Backfill Signals" wrapper to skip agents that already produced a signal for the bar.
 */
export async function upsertSignalsForMarketCloseFromBars(
  admin: SupabaseClient,
  body: {
    marketId: string;
    marketSymbol: string;
    timeframe: string;
    closeTimeIso: string;
    sortedBarsAsc: SortedBar[];
    signalUserIds: string[];
    candleSyncRunId?: string | null;
    signalsSyncRunId?: string | null;
    /** Restrict evaluation to these `signal_agents.id` rows (default: all active agents that match the timeframe). */
    agentIdFilter?: string[];
  },
): Promise<number> {
  const signalUserIds = await filterSignalUserIdsToExistingAuthUsers(admin, body.signalUserIds);
  if (!signalUserIds.length) return 0;

  const agents = await SignalAgentsSelector.selectActiveWithConfig(admin);

  const filterSet = body.agentIdFilter && body.agentIdFilter.length > 0 ? new Set(body.agentIdFilter) : null;
  const activeAgents = agents.filter((a) => {
    if (filterSet && !filterSet.has(a.id)) return false;
    const tf = a.allowed_timeframes;
    if (!tf || tf.length === 0) return true;
    return tf.includes(body.timeframe);
  });

  const barsAsc: MaCrossBar[] = body.sortedBarsAsc.map((r) => ({
    close: r.close,
    closeTimeIso: r.closeTimeIso,
    high: r.high,
    low: r.low,
  }));
  const targetRow = body.sortedBarsAsc.find((r) => closeTimesMatch(r.closeTimeIso, body.closeTimeIso));
  const candleId = targetRow?.id ?? null;

  let signalsUpserted = 0;
  for (const agent of activeAgents) {
    const cfg = (agent.config ?? {}) as Record<string, unknown>;
    let ev:
      | ReturnType<typeof evaluateMaCrossAtClose>
      | ReturnType<typeof evaluateRsiReversionAtClose>
      | ReturnType<typeof evaluateBreakoutAtrAtClose>;
    const minAtrPct = parseGateNumber(cfg.minAtrPct);
    const maxAtrPct = parseGateNumber(cfg.maxAtrPct);
    if (agent.agent_id === "ma-cross-15m-v1") {
      const fastPeriod = Math.floor(Number(cfg.fastPeriod ?? 9));
      const slowPeriod = Math.floor(Number(cfg.slowPeriod ?? 21));
      ev = evaluateMaCrossAtClose({
        barsAsc,
        targetCloseTimeIso: body.closeTimeIso,
        fastPeriod,
        slowPeriod,
        minAtrPct,
        maxAtrPct,
      });
    } else if (agent.agent_id === "rsi-reversion-15m-v1") {
      const rsiPeriod = Math.floor(Number(cfg.rsiPeriod ?? 14));
      const oversold = Number(cfg.oversold ?? 30);
      const overbought = parseGateNumber(cfg.overbought);
      const maxAdx = parseGateNumber(cfg.maxAdx);
      ev = evaluateRsiReversionAtClose({
        barsAsc,
        targetCloseTimeIso: body.closeTimeIso,
        rsiPeriod,
        oversold,
        overbought,
        minAtrPct,
        maxAtrPct,
        maxAdx,
      });
    } else if (agent.agent_id === "breakout-atr-15m-v1") {
      const lookbackBars = Math.floor(Number(cfg.lookbackBars ?? 20));
      const atrPeriod = Math.floor(Number(cfg.atrPeriod ?? 14));
      const atrMultiplier = Number(cfg.atrMultiplier ?? 1.2);
      const volumeConfirmationMultiplier = parseGateNumber(cfg.volumeConfirmationMultiplier);
      const volumeLookbackBars = parseGateNumber(cfg.volumeLookbackBars);
      const minAdx = parseGateNumber(cfg.minAdx);
      ev = evaluateBreakoutAtrAtClose({
        barsAsc: body.sortedBarsAsc.map((r) => ({
          high: r.high,
          low: r.low,
          close: r.close,
          closeTimeIso: r.closeTimeIso,
          volume: r.volume,
        })),
        targetCloseTimeIso: body.closeTimeIso,
        lookbackBars,
        atrPeriod,
        atrMultiplier,
        minAtrPct,
        maxAtrPct,
        volumeConfirmationMultiplier,
        ...(volumeLookbackBars != null
          ? { volumeLookbackBars: Math.max(2, Math.floor(volumeLookbackBars)) }
          : {}),
        minAdx,
      });
    } else {
      continue;
    }

    for (const userId of signalUserIds) {
      if (!candleId) continue;
      const row = {
        user_id: userId,
        signal_agent_id: agent.id,
        candle_id: candleId,
        intent: ev.intent,
        signal_side: ev.signalSide ?? "long",
        confidence: ev.confidence,
        reasons: ev.reasons,
        metadata: {
          ...ev.metadata,
          market_symbol: body.marketSymbol,
          agent_id: agent.agent_id,
          historicalReplay: true,
          ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
          ...(body.signalsSyncRunId ? { signalsSyncRunId: body.signalsSyncRunId } : {}),
        },
      };

      const { error: upErr } = await admin.schema("trading").from("signals").upsert(row, {
        onConflict: "user_id,signal_agent_id,candle_id",
      });
      if (upErr) throw new Error(`${body.marketSymbol}: signals upsert: ${upErr.message}`);
      signalsUpserted += 1;
    }
  }

  return signalsUpserted;
}
