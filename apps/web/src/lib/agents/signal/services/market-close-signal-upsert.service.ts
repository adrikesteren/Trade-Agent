import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { closeTimesMatch } from "@/lib/trading/close-time-match";

import { evaluateMaCrossAtClose, type MaCrossBar } from "./ma-cross-eval.service";
import { evaluateRsiReversionAtClose } from "./rsi-reversion-eval.service";
import { evaluateBreakoutAtrAtClose } from "./breakout-atr-eval.service";
import { evaluateRegimeAtClose } from "./regime-classifier-eval.service";
import { evaluateMultiTfConfluenceAtClose } from "./multi-timeframe-confluence-eval.service";
import { filterSignalUserIdsToExistingAuthUsers } from "./signal-user-ids.service";
import { aggregateReplayBarsToTimeframe } from "@/lib/markets/aggregate-replay-bars";

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
 * `onlyAgentIds` (optional): when set, restrict evaluation to those `signal_agents.id` values
 * (used by `runMarketEvaluateAllSignals` to skip agent/candle pairs that already have signals).
 * Absent = legacy behavior (all enabled agents whose `allowed_timeframes` matches).
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
    onlyAgentIds?: ReadonlySet<string>;
  },
): Promise<number> {
  const signalUserIds = await filterSignalUserIdsToExistingAuthUsers(admin, body.signalUserIds);
  if (!signalUserIds.length) return 0;
  if (body.onlyAgentIds && body.onlyAgentIds.size === 0) return 0;

  const { data: agentRows, error: agentErr } = await admin
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, config, allowed_timeframes")
    .eq("enabled", true);
  if (agentErr) throw new Error(agentErr.message);

  const agents = (agentRows ?? []) as {
    id: string;
    agent_id: string;
    enabled: boolean;
    config: unknown;
    allowed_timeframes: string[] | null;
  }[];

  const activeAgents = agents.filter((a) => {
    if (body.onlyAgentIds && !body.onlyAgentIds.has(a.id)) return false;
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
      | ReturnType<typeof evaluateBreakoutAtrAtClose>
      | ReturnType<typeof evaluateRegimeAtClose>
      | ReturnType<typeof evaluateMultiTfConfluenceAtClose>;
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
    } else if (agent.agent_id === "regime-classifier-15m-v1") {
      // Same trend-timeframe handling as the live dispatcher; default seed = 4h × MA(200).
      const maPeriod = Math.floor(Number(cfg.maPeriod ?? 200));
      const slopeBars = Math.floor(Number(cfg.slopeLookback ?? 20));
      const trendTimeframeMinutes = Math.max(15, Math.floor(Number(cfg.trendTimeframeMinutes ?? 240)));
      const slopePctEps = parseGateNumber(cfg.slopePctEps) ?? undefined;
      const distancePctEps = parseGateNumber(cfg.distancePctEps) ?? undefined;
      const trendBars = aggregateReplayBarsToTimeframe(barsAsc, trendTimeframeMinutes);
      ev = evaluateRegimeAtClose({
        barsAsc: trendBars,
        targetCloseTimeIso: body.closeTimeIso,
        maPeriod,
        slopeBars,
        trendTimeframeMinutes,
        ...(slopePctEps != null ? { slopePctEps } : {}),
        ...(distancePctEps != null ? { distancePctEps } : {}),
      });
    } else if (agent.agent_id === "multi-tf-confluence-15m-v1") {
      const trendMa = Math.floor(Number(cfg.trendMa ?? 50));
      const entryRsiPeriod = Math.floor(Number(cfg.entryRsiPeriod ?? 14));
      const entryRsi = Number(cfg.entryRsi ?? 30);
      const trendBars = aggregateReplayBarsToTimeframe(barsAsc, 240);
      ev = evaluateMultiTfConfluenceAtClose({
        trendBarsAsc: trendBars,
        entryBarsAsc: barsAsc,
        targetCloseTimeIso: body.closeTimeIso,
        trendMa,
        entryRsiPeriod,
        entryRsi,
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
