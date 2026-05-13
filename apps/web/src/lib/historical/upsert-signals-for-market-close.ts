import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { closeTimesMatch } from "@/lib/trading/close-time-match";
import { evaluateMaCrossAtClose, type MaCrossBar } from "@/lib/signals/ma-cross-eval";
import { evaluateRsiReversionAtClose } from "@/lib/signals/rsi-reversion-eval";
import { evaluateBreakoutAtrAtClose } from "@/lib/signals/breakout-atr-eval";
import { filterSignalUserIdsToExistingAuthUsers } from "@/lib/signals/signal-user-ids";

type SortedBar = {
  id: string;
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
};

/**
 * Upserts `trading.signals` for one catalog close using preloaded ascending bars (same agents as catalog-close).
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
  },
): Promise<number> {
  const signalUserIds = await filterSignalUserIdsToExistingAuthUsers(admin, body.signalUserIds);
  if (!signalUserIds.length) return 0;

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
    const tf = a.allowed_timeframes;
    if (!tf || tf.length === 0) return true;
    return tf.includes(body.timeframe);
  });

  const barsAsc: MaCrossBar[] = body.sortedBarsAsc.map((r) => ({ close: r.close, closeTimeIso: r.closeTimeIso }));
  const targetRow = body.sortedBarsAsc.find((r) => closeTimesMatch(r.closeTimeIso, body.closeTimeIso));
  const candleId = targetRow?.id ?? null;

  let signalsUpserted = 0;
  for (const agent of activeAgents) {
    const cfg = (agent.config ?? {}) as Record<string, unknown>;
    let ev:
      | ReturnType<typeof evaluateMaCrossAtClose>
      | ReturnType<typeof evaluateRsiReversionAtClose>
      | ReturnType<typeof evaluateBreakoutAtrAtClose>;
    if (agent.agent_id === "ma-cross-15m-v1") {
      const fastPeriod = Math.floor(Number(cfg.fastPeriod ?? 9));
      const slowPeriod = Math.floor(Number(cfg.slowPeriod ?? 21));
      ev = evaluateMaCrossAtClose({
        barsAsc,
        targetCloseTimeIso: body.closeTimeIso,
        fastPeriod,
        slowPeriod,
      });
    } else if (agent.agent_id === "rsi-reversion-15m-v1") {
      const rsiPeriod = Math.floor(Number(cfg.rsiPeriod ?? 14));
      const oversold = Number(cfg.oversold ?? 30);
      ev = evaluateRsiReversionAtClose({
        barsAsc,
        targetCloseTimeIso: body.closeTimeIso,
        rsiPeriod,
        oversold,
      });
    } else if (agent.agent_id === "breakout-atr-15m-v1") {
      const lookbackBars = Math.floor(Number(cfg.lookbackBars ?? 20));
      const atrPeriod = Math.floor(Number(cfg.atrPeriod ?? 14));
      const atrMultiplier = Number(cfg.atrMultiplier ?? 1.2);
      ev = evaluateBreakoutAtrAtClose({
        barsAsc: body.sortedBarsAsc.map((r) => ({
          high: r.high,
          low: r.low,
          close: r.close,
          closeTimeIso: r.closeTimeIso,
        })),
        targetCloseTimeIso: body.closeTimeIso,
        lookbackBars,
        atrPeriod,
        atrMultiplier,
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
