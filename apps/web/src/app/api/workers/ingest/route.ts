import { DEFAULT_RAILS } from "@/lib/default-rails";
import { barsForRetention, deleteExpiredMarketCandles } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { ensureMarket } from "@/lib/markets/ensure-market";
import { executePaperOrder } from "@/lib/paper-executor";
import { verifyQStashRequest } from "@/lib/qstash";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { BitvavoAdapter } from "@repo/exchange";
import { acquireLock, createRedis, idempotentOnce, releaseLock } from "@repo/redis";
import type { RiskStateSnapshot } from "@repo/risk";
import { runMediator } from "@repo/trading";
import { NextResponse } from "next/server";

type IngestPayload = {
  userId: string;
  connectorId: string;
  symbol: string;
  timeframe: string;
};

function parsePayload(raw: unknown): IngestPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.userId === "string" &&
    typeof o.connectorId === "string" &&
    typeof o.symbol === "string" &&
    typeof o.timeframe === "string"
  ) {
    return {
      userId: o.userId,
      connectorId: o.connectorId,
      symbol: o.symbol,
      timeframe: o.timeframe,
    };
  }
  return null;
}

function mapRiskRow(row: {
  equity_eur: number;
  open_position_count: number;
  exposure_by_symbol: Record<string, number> | null;
  daily_pnl_eur: number;
  max_drawdown_eur: number;
  consecutive_losses: number;
  kill_switch: boolean;
}): RiskStateSnapshot {
  return {
    equityEur: Number(row.equity_eur),
    openPositionCount: row.open_position_count,
    exposureBySymbolEur: row.exposure_by_symbol ?? {},
    dailyPnlEur: Number(row.daily_pnl_eur),
    maxDrawdownEur: Number(row.max_drawdown_eur),
    consecutiveLosses: row.consecutive_losses,
    killSwitch: row.kill_switch,
  };
}

async function refreshRiskAggregates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  connectorId: string,
) {
  const { data: pos } = await supabase
    .from("positions")
    .select("symbol, quantity, avg_price")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .eq("paper", true);

  const exposure: Record<string, number> = {};
  let openCount = 0;
  for (const p of pos ?? []) {
    const qty = Number(p.quantity);
    const avg = p.avg_price != null ? Number(p.avg_price) : 0;
    if (qty > 0) {
      openCount += 1;
      exposure[String(p.symbol)] = qty * avg;
    }
  }

  await supabase
    .from("risk_state")
    .update({
      open_position_count: openCount,
      exposure_by_symbol: exposure,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  const ok = await verifyQStashRequest(request, bodyText);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const payload = parsePayload(parsed);
  if (!payload) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: connector, error: connErr } = await supabase
    .from("connectors")
    .select("id, user_id, exchange")
    .eq("id", payload.connectorId)
    .eq("user_id", payload.userId)
    .maybeSingle();

  if (connErr || !connector) {
    return NextResponse.json({ error: "connector_not_found" }, { status: 404 });
  }

  const redis = createRedis();
  let lock = null as Awaited<ReturnType<typeof acquireLock>>;
  if (redis) {
    lock = await acquireLock(redis, `ingest:${payload.userId}:${payload.connectorId}`, 30_000);
    if (!lock) {
      return NextResponse.json({ skipped: true, reason: "lock_held" });
    }
  }

  try {
    const adapter = new BitvavoAdapter();
    const baseTf = CATALOG_STORAGE_TIMEFRAME;
    const candleLimit = barsForRetention(baseTf);
    const candles = await adapter.listCandles({
      symbol: payload.symbol,
      timeframe: baseTf,
      limit: candleLimit,
    });

    const { marketId } = await ensureMarket(supabase, {
      exchangeCode: String(connector.exchange).toLowerCase() || "bitvavo",
      marketSymbol: payload.symbol,
    });

    const ecRows = candles.map((c) => ({
      market_id: marketId,
      timeframe: c.timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      open_time: c.openTime,
      close_time: c.closeTime,
    }));

    if (ecRows.length) {
      const { error: upErr } = await supabase.from("candles").upsert(ecRows, {
        onConflict: "market_id,timeframe,close_time",
      });
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 });
      }
    }

    await deleteExpiredMarketCandles(supabase);

    const last = candles[candles.length - 1];
    if (!last) {
      return NextResponse.json({ ok: true, candles: 0 });
    }

    if (redis) {
      const onceKey = `ingest:${payload.connectorId}:${last.closeTime}`;
      const fresh = await idempotentOnce(redis, onceKey, 86_400);
      if (!fresh) {
        return NextResponse.json({ skipped: true, reason: "idempotent" });
      }
    }

    const stubAction = last.close > last.open ? ("buy" as const) : ("hold" as const);

    const { data: mcRow } = await supabase
      .from("candles")
      .select("id")
      .eq("market_id", marketId)
      .eq("timeframe", last.timeframe)
      .eq("close_time", last.closeTime)
      .maybeSingle();

    const { data: sig, error: sigErr } = await supabase
      .from("signals")
      .insert({
        user_id: payload.userId,
        connector_id: payload.connectorId,
        market_candle_id: mcRow?.id ?? null,
        symbol: last.symbol,
        agent_id: "stub_close_vs_open",
        action: stubAction,
        confidence: 0.5,
        reasons: { rule: "close_gt_open", close: last.close, open: last.open },
        invalidation: {},
      })
      .select("id")
      .single();

    if (sigErr || !sig) {
      return NextResponse.json({ error: sigErr?.message ?? "signal" }, { status: 500 });
    }

    const { data: riskRow, error: riskErr } = await supabase
      .from("risk_state")
      .select(
        "equity_eur, open_position_count, exposure_by_symbol, daily_pnl_eur, max_drawdown_eur, consecutive_losses, kill_switch",
      )
      .eq("user_id", payload.userId)
      .eq("connector_id", payload.connectorId)
      .maybeSingle();

    if (riskErr || !riskRow) {
      return NextResponse.json({ error: "risk_state_missing" }, { status: 400 });
    }

    const riskSnap = mapRiskRow(riskRow as Parameters<typeof mapRiskRow>[0]);
    const decision = runMediator({
      rails: DEFAULT_RAILS,
      risk: riskSnap,
      signal: {
        agentId: "stub_close_vs_open",
        symbol: last.symbol,
        action: stubAction,
        confidence: 0.5,
        notionalEur: 100,
      },
    });

    const { data: dec, error: decErr } = await supabase
      .from("trade_decisions")
      .insert({
        user_id: payload.userId,
        signal_id: sig.id,
        approved: decision.approved,
        reason_codes: decision.reasonCodes,
        risk_snapshot: decision.riskSnapshot as unknown as Record<string, unknown>,
      })
      .select("id")
      .single();

    if (decErr || !dec) {
      return NextResponse.json({ error: decErr?.message ?? "decision" }, { status: 500 });
    }

    if (decision.approved && decision.proposed) {
      await executePaperOrder({
        supabase,
        userId: payload.userId,
        connectorId: payload.connectorId,
        decisionId: dec.id as string,
        proposed: decision.proposed,
        price: last.close,
      });
      await refreshRiskAggregates(supabase, payload.userId, payload.connectorId);
    }

    return NextResponse.json({
      ok: true,
      candles: ecRows.length,
      signalId: sig.id,
      decisionId: dec.id,
      approved: decision.approved,
    });
  } finally {
    if (redis && lock) await releaseLock(redis, lock);
  }
}
