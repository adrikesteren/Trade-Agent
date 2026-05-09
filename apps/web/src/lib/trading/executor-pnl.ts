import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { barsForRetention } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

export type ExecutorPnlSnapshot = {
  filledBuyNotionalEur: number;
  openCostBasisEur: number;
  openMarkValueEur: number | null;
  unrealizedEur: number | null;
};

async function latestCloseForMarket(
  admin: SupabaseClient,
  marketId: string,
  timeframe: string,
): Promise<number | null> {
  const { data, error } = await admin
    .schema("catalog")
    .from("candles")
    .select("close, candle_timestamps ( close_time )")
    .eq("market_id", marketId)
    .eq("timeframe", timeframe)
    .limit(barsForRetention(timeframe));
  if (error) throw new Error(error.message);
  type Row = { close: string | number; candle_timestamps: { close_time: string } | { close_time: string }[] | null };
  const rows = (data ?? []) as Row[];
  let best: { t: number; close: number } | null = null;
  for (const r of rows) {
    const rawTs = r.candle_timestamps as unknown;
    const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
    const ct = ts?.close_time;
    if (!ct) continue;
    const t = Date.parse(ct);
    const close = Number(r.close);
    if (!Number.isFinite(t) || !Number.isFinite(close)) continue;
    if (!best || t > best.t) best = { t, close };
  }
  return best?.close ?? null;
}

/** Spot v1: buy notional filled, open cost basis, optional mark/unrealized from latest catalog closes. */
export async function loadExecutorPnlSnapshot(
  admin: SupabaseClient,
  params: { executorId: string; userId: string; timeframe?: string },
): Promise<ExecutorPnlSnapshot> {
  const timeframe = params.timeframe ?? CATALOG_STORAGE_TIMEFRAME;

  const { data: ordRows, error: ordErr } = await admin
    .schema("trading")
    .from("orders")
    .select("notional_eur, side, status")
    .eq("executor_id", params.executorId)
    .eq("user_id", params.userId)
    .eq("status", "filled");
  if (ordErr) throw new Error(ordErr.message);

  let filledBuyNotionalEur = 0;
  for (const o of ordRows ?? []) {
    if (String(o.side) !== "buy") continue;
    const n = Number(o.notional_eur ?? 0);
    if (Number.isFinite(n)) filledBuyNotionalEur += n;
  }

  const { data: posRows, error: posErr } = await admin
    .schema("trading")
    .from("positions")
    .select("market_id, quantity, avg_price")
    .eq("executor_id", params.executorId)
    .eq("user_id", params.userId);
  if (posErr) throw new Error(posErr.message);

  let openCostBasisEur = 0;
  const openPositions: { market_id: string; qty: number; avg: number }[] = [];
  for (const p of posRows ?? []) {
    const qty = Number(p.quantity ?? 0);
    const avg = p.avg_price != null ? Number(p.avg_price) : Number.NaN;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(avg)) continue;
    openCostBasisEur += qty * avg;
    openPositions.push({ market_id: p.market_id as string, qty, avg });
  }

  if (!openPositions.length) {
    return {
      filledBuyNotionalEur,
      openCostBasisEur,
      openMarkValueEur: openCostBasisEur > 0 ? openCostBasisEur : null,
      unrealizedEur: 0,
    };
  }

  let markSum = 0;
  let missingMark = false;
  for (const p of openPositions) {
    const px = await latestCloseForMarket(admin, p.market_id, timeframe);
    if (px == null || !Number.isFinite(px)) {
      missingMark = true;
      break;
    }
    markSum += p.qty * px;
  }

  if (missingMark) {
    return {
      filledBuyNotionalEur,
      openCostBasisEur,
      openMarkValueEur: null,
      unrealizedEur: null,
    };
  }

  const unrealizedEur = markSum - openCostBasisEur;
  return {
    filledBuyNotionalEur,
    openCostBasisEur,
    openMarkValueEur: markSum,
    unrealizedEur,
  };
}
