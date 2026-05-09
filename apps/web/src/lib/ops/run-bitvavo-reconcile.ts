import "server-only";

import { acquireLock, createRedis, releaseLock, type LockHandle } from "@repo/redis";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mapBitvavoOrderStatusToDb } from "@/lib/bitvavo/bitvavo-order-status";
import { fetchBitvavoOrder } from "@/lib/bitvavo/fetch-bitvavo-order";
import { bitvavoPrivateEnv } from "@/lib/bitvavo/signed-request";
import { mergeBuyPositionAvg } from "@/lib/executor/paper-fill";
import { createServiceRoleClient } from "@/lib/supabase/admin";

function batchSize(): number {
  const n = Number(process.env.BITVAVO_RECONCILE_BATCH ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

function lockTtlMs(): number {
  const n = Number(process.env.BITVAVO_RECONCILE_LOCK_TTL_MS ?? 9 * 60 * 1000);
  if (!Number.isFinite(n) || n < 10_000) return 9 * 60 * 1000;
  return Math.min(Math.floor(n), 30 * 60 * 1000);
}

export type RunBitvavoReconcileResult = {
  ok: true;
  examined: number;
  updated: number;
  fillsInserted: number;
  errors: string[];
  skipped?: "lock_not_acquired" | "no_bitvavo_keys";
};

type OrderRow = {
  id: string;
  user_id: string;
  executor_id: string;
  market_id: string;
  external_id: string;
  status: string;
  notional_eur: string | number | null;
  quantity: string | number | null;
};

async function upsertPositionAfterBuy(
  admin: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    addQty: number;
    price: number;
  },
): Promise<void> {
  const { data: pos, error: selErr } = await admin
    .schema("trading")
    .from("positions")
    .select("id, quantity, avg_price")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  const existingQty = Number(pos?.quantity ?? 0);
  const existingAvg = pos?.avg_price != null ? Number(pos.avg_price) : null;
  const { quantity, avgPrice } = mergeBuyPositionAvg({
    existingQty,
    existingAvg,
    addQty: args.addQty,
    addPrice: args.price,
  });

  const row = {
    user_id: args.userId,
    executor_id: args.executorId,
    market_id: args.marketId,
    paper: false,
    quantity,
    avg_price: avgPrice,
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await admin.schema("trading").from("positions").upsert(row, {
    onConflict: "user_id,executor_id,market_id",
  });
  if (upErr) throw new Error(`positions upsert: ${upErr.message}`);
}

export async function runBitvavoReconcile(): Promise<RunBitvavoReconcileResult> {
  const errors: string[] = [];
  let examined = 0;
  let updated = 0;
  let fillsInserted = 0;

  try {
    bitvavoPrivateEnv();
  } catch {
    return { ok: true, examined: 0, updated: 0, fillsInserted: 0, errors, skipped: "no_bitvavo_keys" };
  }

  const redis = createRedis();
  let lock: LockHandle | null = null;
  if (redis) {
    lock = await acquireLock(redis, "bitvavo-reconcile", lockTtlMs());
    if (!lock) {
      return { ok: true, examined: 0, updated: 0, fillsInserted: 0, errors, skipped: "lock_not_acquired" };
    }
  }

  try {
    const admin = createServiceRoleClient();
    const lim = batchSize();

    const { data: ordRows, error: ordErr } = await admin
      .schema("trading")
      .from("orders")
      .select("id, user_id, executor_id, market_id, external_id, status, notional_eur, quantity")
      .eq("paper", false)
      .in("status", ["pending", "open"])
      .not("external_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(lim);

    if (ordErr) throw new Error(ordErr.message);

    const orders = (ordRows ?? []) as OrderRow[];
    if (!orders.length) {
      return { ok: true, examined: 0, updated: 0, fillsInserted: 0, errors };
    }

    const execIds = [...new Set(orders.map((o) => o.executor_id))];
    const { data: execRows, error: exErr } = await admin
      .schema("trading")
      .from("executors")
      .select("id, execution_mode")
      .in("id", execIds);
    if (exErr) throw new Error(exErr.message);

    const liveExecutor = new Set(
      (execRows ?? [])
        .filter((e) => String(e.execution_mode) === "live")
        .map((e) => e.id as string),
    );

    const liveOrders = orders.filter((o) => liveExecutor.has(o.executor_id));
    const marketIds = [...new Set(liveOrders.map((o) => o.market_id))];
    const symByMarket = new Map<string, string>();
    if (marketIds.length) {
      const { data: mkts, error: mErr } = await admin
        .schema("catalog")
        .from("markets")
        .select("id, market_symbol")
        .in("id", marketIds);
      if (mErr) throw new Error(mErr.message);
      for (const m of mkts ?? []) {
        symByMarket.set(m.id as string, String(m.market_symbol ?? "").trim());
      }
    }

    for (const o of liveOrders) {
      examined += 1;
      const marketSymbol = symByMarket.get(o.market_id);
      if (!marketSymbol) {
        errors.push(`order ${o.id}: missing market_symbol`);
        continue;
      }

      try {
        const snap = await fetchBitvavoOrder({ market: marketSymbol, orderId: o.external_id });
        if (!snap) {
          errors.push(`order ${o.id}: Bitvavo order not found`);
          continue;
        }

        const dbStatus = mapBitvavoOrderStatusToDb(snap.status);
        const fillsRaw = snap.raw.fills;
        let fillPrice = Number.NaN;
        let fillQty = Number.NaN;
        let fillFee = 0;
        if (Array.isArray(fillsRaw) && fillsRaw.length > 0) {
          const f0 = fillsRaw[0] as Record<string, unknown>;
          fillPrice = Number(f0.price);
          fillQty = Number(f0.amount);
          fillFee = Number(f0.fee ?? 0);
        } else if (dbStatus === "filled") {
          fillQty = Number.isFinite(snap.filledAmount) ? snap.filledAmount : Number.NaN;
          const notional = Number(o.notional_eur ?? 0);
          fillPrice =
            Number.isFinite(fillQty) && fillQty > 0 && Number.isFinite(notional) && notional > 0
              ? notional / fillQty
              : Number.isFinite(snap.price) && snap.price > 0
                ? snap.price
                : Number.NaN;
        }

        const prevQty = Number(o.quantity ?? 0);
        let qtyUpdate = prevQty;
        if (dbStatus === "filled" && Number.isFinite(fillQty) && fillQty > 0) {
          qtyUpdate = fillQty;
        } else if (dbStatus === "open" && Number.isFinite(snap.filledAmount) && snap.filledAmount > 0) {
          qtyUpdate = snap.filledAmount;
        }

        const { data: existingFill } = await admin
          .schema("trading")
          .from("fills")
          .select("id")
          .eq("order_id", o.id)
          .maybeSingle();

        if (dbStatus === "filled" && !existingFill) {
          if (Number.isFinite(fillPrice) && Number.isFinite(fillQty) && fillQty > 0) {
            const { error: fillErr } = await admin.schema("trading").from("fills").insert({
              user_id: o.user_id,
              order_id: o.id,
              price: fillPrice,
              quantity: fillQty,
              fee: Number.isFinite(fillFee) ? fillFee : 0,
            });
            if (fillErr) throw new Error(fillErr.message);
            fillsInserted += 1;
            await upsertPositionAfterBuy(admin, {
              userId: o.user_id,
              executorId: o.executor_id,
              marketId: o.market_id,
              addQty: fillQty,
              price: fillPrice,
            });
          }
        }

        const statusChanged = String(o.status) !== dbStatus;
        const qtyChanged = qtyUpdate !== prevQty;
        if (statusChanged || qtyChanged) {
          const { error: upOrd } = await admin
            .schema("trading")
            .from("orders")
            .update({
              status: dbStatus,
              quantity: qtyUpdate,
              updated_at: new Date().toISOString(),
            })
            .eq("id", o.id);
          if (upOrd) throw new Error(upOrd.message);
          updated += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`order ${o.id}: ${msg}`);
      }
    }

    return { ok: true, examined, updated, fillsInserted, errors };
  } finally {
    if (redis && lock) await releaseLock(redis, lock);
  }
}
