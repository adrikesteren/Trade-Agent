import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveExecutorWalletId } from "@/lib/objects/executors/services/executor-wallet-resolve.service";

/** Paper fee model (matches `run-executor-catalog-close` paper path). */
export function executorPaperFeeEur(notionalEur: number): number {
  if (!Number.isFinite(notionalEur) || notionalEur <= 0) return 0;
  return Math.round(notionalEur * 0.0025 * 1e8) / 1e8;
}

/** Spendable units for one wallet + asset from `trading.wallet_asset_balance` (kept in sync on each `wallet_transactions` insert). */
export async function fetchWalletBalanceForAsset(
  admin: SupabaseClient,
  args: { executorId: string; assetId: string },
): Promise<number> {
  const walletId = await resolveExecutorWalletId(admin, { executorId: args.executorId });
  if (!walletId) return 0;

  const { data: bal, error } = await admin
    .schema("trading")
    .from("wallet_asset_balance")
    .select("amount")
    .eq("wallet_id", walletId)
    .eq("asset_id", args.assetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (bal as { amount?: unknown } | null)?.amount;
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** @deprecated name — returns wallet balance for the quote asset (same numeric role as former `equity_eur`). */
export async function fetchExecutorEquityEur(
  admin: SupabaseClient,
  args: { userId: string; executorId: string; quoteAssetId: string },
): Promise<number> {
  void args.userId;
  return fetchWalletBalanceForAsset(admin, { executorId: args.executorId, assetId: args.quoteAssetId });
}

export function tradeBuyDebitEur(notionalEur: number, feeEur: number): number {
  const n = Number(notionalEur);
  const f = Number(feeEur);
  const nn = Number.isFinite(n) ? n : 0;
  const ff = Number.isFinite(f) ? f : 0;
  return nn + ff;
}

export function tradeSellCreditEur(notionalEur: number, feeEur: number): number {
  const n = Number(notionalEur);
  const f = Number(feeEur);
  const nn = Number.isFinite(n) ? n : 0;
  const ff = Number.isFinite(f) ? f : 0;
  return Math.max(0, nn - ff);
}

/** Service role: idempotent wallet debit for a filled buy order (quote asset). */
export async function applyExecutorTradeBuyDebit(
  admin: SupabaseClient,
  args: { userId: string; executorId: string; orderId: string; debitEur: number },
): Promise<{ newEquityEur: number }> {
  const { data, error } = await admin.schema("trading").rpc("apply_wallet_trade_buy_debit", {
    p_user_id: args.userId,
    p_executor_id: args.executorId,
    p_order_id: args.orderId,
    p_debit_eur: args.debitEur,
  });
  if (error) throw new Error(error.message);
  const newEquityEur = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(newEquityEur)) throw new Error("apply_wallet_trade_buy_debit: invalid return");
  return { newEquityEur };
}

/** Service role: idempotent wallet credit for a filled sell order (quote asset). */
export async function applyExecutorTradeSellCredit(
  admin: SupabaseClient,
  args: { userId: string; executorId: string; orderId: string; creditEur: number },
): Promise<{ newEquityEur: number }> {
  const { data, error } = await admin.schema("trading").rpc("apply_wallet_trade_sell_credit", {
    p_user_id: args.userId,
    p_executor_id: args.executorId,
    p_order_id: args.orderId,
    p_credit_eur: args.creditEur,
  });
  if (error) throw new Error(error.message);
  const newEquityEur = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(newEquityEur)) throw new Error("apply_wallet_trade_sell_credit: invalid return");
  return { newEquityEur };
}

export type PositionSnapshot = {
  quantity: number;
  avg_price: number | null;
  paper: boolean;
} | null;

export async function fetchExecutorPositionSnapshot(
  admin: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<PositionSnapshot> {
  const { data: pos, error: selErr } = await admin
    .schema("trading")
    .from("positions")
    .select("quantity, avg_price, paper")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!pos) return null;
  const qty = Number(pos.quantity ?? 0);
  const avg = pos.avg_price != null ? Number(pos.avg_price) : null;
  return {
    quantity: qty,
    avg_price: avg != null && Number.isFinite(avg) ? avg : null,
    paper: Boolean(pos.paper),
  };
}

export async function restoreExecutorPositionSnapshot(
  admin: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    snapshot: PositionSnapshot;
  },
): Promise<void> {
  const { userId, executorId, marketId, snapshot } = args;
  if (!snapshot || snapshot.quantity <= 0 || snapshot.avg_price == null || !Number.isFinite(snapshot.avg_price)) {
    const { error: delErr } = await admin
      .schema("trading")
      .from("positions")
      .delete()
      .eq("user_id", userId)
      .eq("executor_id", executorId)
      .eq("market_id", marketId);
    if (delErr) throw new Error(delErr.message);
    return;
  }

  const row = {
    user_id: userId,
    executor_id: executorId,
    market_id: marketId,
    paper: snapshot.paper,
    quantity: snapshot.quantity,
    avg_price: snapshot.avg_price,
    updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await admin.schema("trading").from("positions").upsert(row, {
    onConflict: "user_id,executor_id,market_id",
  });
  if (upErr) throw new Error(upErr.message);
}
