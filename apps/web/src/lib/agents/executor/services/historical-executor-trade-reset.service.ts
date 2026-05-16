import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveExecutorWalletId } from "@/lib/objects/executors/services/executor-wallet-resolve.service";

/**
 * Counts of rows removed per table during a reset. Useful for UI feedback so the user
 * can see at a glance what was wiped (and confirm the wipe actually did something).
 */
export type ResetHistoricalExecutorTradeResult = {
  fillsDeleted: number;
  ordersDeleted: number;
  decisionsDeleted: number;
  positionsDeleted: number;
  movingFloorsDeleted: number;
  historicalRunsDeleted: number;
  walletTransactionsDeleted: number;
  walletAssetBalancesDeleted: number;
  walletKind: string | null;
  walletId: string | null;
};

/**
 * Wipes everything the trade-mediator and executor produced for a single **historical**
 * executor so the next replay starts from a clean slate. Wallet ledger (transactions +
 * derived per-asset balances) is **also** wiped because a historical executor owns its
 * wallet 1:1 (`kind = 'historical_paper'`); the user simply re-deposits afterwards.
 *
 * Strict safety net: this service refuses to run when the executor is not historical or
 * when the resolved wallet is not `historical_paper`. That keeps the same code path from
 * ever nuking a `shared_exchange` wallet that paper + live executors depend on.
 *
 * Order is FK-safe: fills → orders → decisions → positions → moving floors → historical
 * runs → wallet_transactions → wallet_asset_balance → reset risk counters on executor.
 */
export async function resetHistoricalExecutorTradeState(
  admin: SupabaseClient,
  args: { userId: string; executorId: string },
): Promise<ResetHistoricalExecutorTradeResult> {
  const userId = String(args.userId ?? "").trim();
  const executorId = String(args.executorId ?? "").trim();
  if (!userId) throw new Error("userId is required");
  if (!executorId) throw new Error("executorId is required");

  // 1) Validate the executor exists, belongs to the caller, and is historical.
  const { data: exRow, error: exErr } = await admin
    .schema("trading")
    .from("executors")
    .select("id, user_id, execution_mode, wallet_id")
    .eq("id", executorId)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  const ex = (exRow ?? null) as
    | { id: string; user_id: string; execution_mode: string; wallet_id: string | null }
    | null;
  if (!ex) throw new Error("Executor not found.");
  if (ex.user_id !== userId) throw new Error("Executor does not belong to this user.");
  if (String(ex.execution_mode) !== "historical") {
    throw new Error(
      `Reset trade is only available for historical executors (got execution_mode='${ex.execution_mode}').`,
    );
  }

  // 2) Delete fills (via order_id) → orders → decisions, all scoped by executor_id.
  let fillsDeleted = 0;
  let ordersDeleted = 0;
  const { data: orderRows, error: oSelErr } = await admin
    .schema("trading")
    .from("orders")
    .select("id")
    .eq("executor_id", executorId);
  if (oSelErr) throw new Error(oSelErr.message);
  const orderIds = ((orderRows ?? []) as { id: string }[]).map((r) => r.id).filter(Boolean);
  if (orderIds.length > 0) {
    /** Keep PostgREST filter URLs under typical reverse-proxy limits (avoid `URI TOO LONG`). */
    const chunk = 80;
    for (let i = 0; i < orderIds.length; i += chunk) {
      const part = orderIds.slice(i, i + chunk);
      const { error: fDel, count: fCount } = await admin
        .schema("trading")
        .from("fills")
        .delete({ count: "exact" })
        .in("order_id", part);
      if (fDel) throw new Error(fDel.message);
      fillsDeleted += fCount ?? 0;

      const { error: oDel, count: oCount } = await admin
        .schema("trading")
        .from("orders")
        .delete({ count: "exact" })
        .in("id", part);
      if (oDel) throw new Error(oDel.message);
      ordersDeleted += oCount ?? 0;
    }
  }

  const { error: decDel, count: decCount } = await admin
    .schema("trading")
    .from("decisions")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("executor_id", executorId);
  if (decDel) throw new Error(decDel.message);
  const decisionsDeleted = decCount ?? 0;

  // 3) Positions, moving floors, historical-run history.
  const { error: posDel, count: posCount } = await admin
    .schema("trading")
    .from("positions")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("executor_id", executorId);
  if (posDel) throw new Error(posDel.message);
  const positionsDeleted = posCount ?? 0;

  const { error: flDel, count: flCount } = await admin
    .schema("trading")
    .from("executor_moving_floors")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("executor_id", executorId);
  if (flDel) throw new Error(flDel.message);
  const movingFloorsDeleted = flCount ?? 0;

  const { error: runDel, count: runCount } = await admin
    .schema("trading")
    .from("executor_historical_runs")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("executor_id", executorId);
  if (runDel) throw new Error(runDel.message);
  const historicalRunsDeleted = runCount ?? 0;

  // 4) Wallet ledger — only if the wallet is the historical_paper one this executor owns.
  let walletTransactionsDeleted = 0;
  let walletAssetBalancesDeleted = 0;
  let walletKind: string | null = null;
  const walletId = await resolveExecutorWalletId(admin, { executorId });
  if (walletId) {
    const { data: wRow, error: wErr } = await admin
      .schema("trading")
      .from("wallets")
      .select("id, kind")
      .eq("id", walletId)
      .maybeSingle();
    if (wErr) throw new Error(wErr.message);
    const w = (wRow ?? null) as { id: string; kind: string | null } | null;
    walletKind = w?.kind ?? null;

    if (w && w.kind === "historical_paper") {
      const { error: txDel, count: txCount } = await admin
        .schema("trading")
        .from("wallet_transactions")
        .delete({ count: "exact" })
        .eq("wallet_id", walletId);
      if (txDel) throw new Error(txDel.message);
      walletTransactionsDeleted = txCount ?? 0;

      const { error: balDel, count: balCount } = await admin
        .schema("trading")
        .from("wallet_asset_balance")
        .delete({ count: "exact" })
        .eq("wallet_id", walletId);
      if (balDel) throw new Error(balDel.message);
      walletAssetBalancesDeleted = balCount ?? 0;
    } else if (w) {
      // Defensive: a historical executor should never end up on a shared_exchange wallet,
      // but if migration/seed code ever assigns one we refuse to wipe live/paper money.
      throw new Error(
        `Refusing to wipe wallet '${walletId}' (kind='${w.kind ?? "unknown"}') — only historical_paper wallets are reset.`,
      );
    }
  }

  // 5) Reset runtime risk counters on the executor (kill switch off, daily PnL zero, etc.).
  const { error: rsUp } = await admin
    .schema("trading")
    .from("executors")
    .update({
      risk_open_position_count: 0,
      risk_daily_pnl_eur: 0,
      risk_runtime_max_drawdown_eur: 0,
      risk_consecutive_losses: 0,
      risk_kill_switch: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", executorId);
  if (rsUp) throw new Error(rsUp.message);

  return {
    fillsDeleted,
    ordersDeleted,
    decisionsDeleted,
    positionsDeleted,
    movingFloorsDeleted,
    historicalRunsDeleted,
    walletTransactionsDeleted,
    walletAssetBalancesDeleted,
    walletKind,
    walletId,
  };
}
