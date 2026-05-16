import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapBitvavoOrderStatusToDb } from "@/lib/bitvavo/bitvavo-order-status";
import { fetchBitvavoOrder } from "@/lib/bitvavo/private/fetch-bitvavo-order";
import {
  bitvavoCredentialsFromExchangeApiFields,
  type BitvavoExchangeCredentials,
} from "@/lib/bitvavo/private/signed-request";
import { mergeBuyPositionAvg } from "@/lib/agents/executor/services/paper-fill.service";
import {
  fetchAssetDisplayNameByMarketId,
  resolveTradeFillAssetDisplayName,
  sendTradeFillSlack,
} from "@/lib/ops/send-trade-fill-slack";
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { fetchMarketAssetIds } from "@/lib/agents/executor/services/executors-lookup.service";
import { applyExecutorTradeBuyDebit, tradeBuyDebitEur } from "@/lib/agents/executor/services/executor-wallet.service";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as FillsSelector from "@/lib/selectors/fills-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import * as OrdersSelector from "@/lib/selectors/orders-selector";
import * as PositionsSelector from "@/lib/selectors/positions-selector";

function batchSize(): number {
  const n = Number(process.env.BITVAVO_RECONCILE_BATCH ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

export type RunBitvavoReconcileResult = {
  ok: true;
  examined: number;
  updated: number;
  fillsInserted: number;
  errors: string[];
};

type OrderRow = {
  id: string;
  user_id: string;
  executor_id: string;
  market_id: string;
  external_id: string;
  status: string;
  side: string;
  notional_eur: string | number | null;
  quantity: string | number | null;
  decision_id: string | null;
};

type OrderRowDb = Omit<OrderRow, "market_id"> & {
  decisions?: {
    signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
  } | {
    signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
  }[] | null;
};

function unwrapOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function marketIdFromOrderRow(r: OrderRowDb, candleById: Map<string, CatalogCandleBar>): string | null {
  const td = unwrapOne(r.decisions);
  const sig = unwrapOne(td?.signals);
  const cid = String(sig?.candle_id ?? "").trim();
  if (!cid) return null;
  const mid = candleById.get(cid)?.market_id?.trim();
  return mid || null;
}

function toReconcileOrder(r: OrderRowDb, candleById: Map<string, CatalogCandleBar>): OrderRow | null {
  const market_id = marketIdFromOrderRow(r, candleById);
  if (!market_id) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    executor_id: r.executor_id,
    market_id,
    external_id: r.external_id,
    status: r.status,
    side: r.side,
    notional_eur: r.notional_eur,
    quantity: r.quantity,
    decision_id: r.decision_id,
  };
}

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
  const pos = await PositionsSelector.selectIdQtyAvgByTrio(admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
  });

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

  try {
    await PositionsSelector.upsertOneByTrio(admin, row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`positions upsert: ${msg}`);
  }
}

export async function runBitvavoReconcile(): Promise<RunBitvavoReconcileResult> {
  const errors: string[] = [];
  let examined = 0;
  let updated = 0;
  let fillsInserted = 0;

  const admin = createServiceRoleClient();
  const lim = batchSize();

  const ordRows = await OrdersSelector.selectLiveOpenForReconcile(admin, { limit: lim });

  const ordersRaw = ordRows as OrderRowDb[];
  const candleIds = ordersRaw
    .map((r) => {
      const td = unwrapOne(r.decisions);
      const sig = unwrapOne(td?.signals);
      return String(sig?.candle_id ?? "").trim();
    })
    .filter(Boolean);
  const candleById = await fetchCatalogCandlesByIds(admin, candleIds);
  const orders = ordersRaw.map((r) => toReconcileOrder(r, candleById)).filter((o): o is OrderRow => o != null);
  if (!orders.length) {
    return { ok: true, examined: 0, updated: 0, fillsInserted: 0, errors };
  }

  const execIds = [...new Set(orders.map((o) => o.executor_id))];
  const execRows = await ExecutorsSelector.selectReconcileByIds(admin, execIds);

  const bitvavoCredsByExecutor = new Map<string, BitvavoExchangeCredentials>();
  for (const e of execRows) {
    const id = e.id;
    const creds = bitvavoCredentialsFromExchangeApiFields(e.exchange_api_key, e.exchange_api_secret);
    if (creds) bitvavoCredsByExecutor.set(id, creds);
  }

  const slackTradeNotifyByExecutor = new Map<string, boolean>();
  const executorNameById = new Map<string, string>();
  for (const e of execRows) {
    const id = e.id;
    slackTradeNotifyByExecutor.set(id, e.slack_trade_notifications_enabled !== false);
    const nm = String(e.name ?? "").trim();
    executorNameById.set(id, nm || "—");
  }

  const catalogExchangeIds = [
    ...new Set(
      execRows
        .map((e) => String(e.exchange_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const exchangeNameByCatalogId = new Map<string, string>();
  if (catalogExchangeIds.length) {
    const cexRows = await ExchangesSelector.selectByIds(admin, catalogExchangeIds);
    for (const row of cexRows) {
      const rid = row.id;
      const nm = String(row.name ?? "").trim();
      const code = String(row.code ?? "").trim();
      exchangeNameByCatalogId.set(rid, nm || code || rid);
    }
  }
  const slackExchangeNameByExecutorId = new Map<string, string>();
  for (const e of execRows) {
    const id = e.id;
    const xid = String(e.exchange_id ?? "").trim();
    slackExchangeNameByExecutorId.set(id, xid ? (exchangeNameByCatalogId.get(xid) ?? xid) : "—");
  }

  const liveExecutor = new Set(
    execRows.filter((e) => String(e.execution_mode) === "live").map((e) => e.id),
  );

  const liveOrders = orders.filter((o) => liveExecutor.has(o.executor_id));
  const marketIds = [...new Set(liveOrders.map((o) => o.market_id))];
  const symByMarket = new Map<string, string>();
  if (marketIds.length) {
    const mkts = await MarketsSelector.selectIdAndSymbolByIds(admin, marketIds);
    for (const m of mkts) {
      symByMarket.set(m.id, String(m.market_symbol ?? "").trim());
    }
  }

  const assetIdByMarket = await fetchMarketAssetIds(admin, marketIds);
  const assetNameByMarketIdRaw = await fetchAssetDisplayNameByMarketId(admin, assetIdByMarket);

  for (const o of liveOrders) {
    examined += 1;
    const marketSymbol = symByMarket.get(o.market_id);
    if (!marketSymbol) {
      errors.push(`order ${o.id}: missing market_symbol`);
      continue;
    }

    try {
      const creds = bitvavoCredsByExecutor.get(o.executor_id);
      if (!creds) {
        errors.push(
          `order ${o.id}: executor ${o.executor_id} has no exchange_api_key / exchange_api_secret (required for live reconcile)`,
        );
        continue;
      }
      const snap = await fetchBitvavoOrder({
        credentials: creds,
        market: marketSymbol,
        orderId: o.external_id,
      });
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

      const existingFill = await FillsSelector.selectIdByOrderId(admin, o.id);

      if (dbStatus === "filled" && !existingFill) {
        if (Number.isFinite(fillPrice) && Number.isFinite(fillQty) && fillQty > 0) {
          try {
            await FillsSelector.insertOne(admin, {
              user_id: o.user_id,
              order_id: o.id,
              price: fillPrice,
              quantity: fillQty,
              fee: Number.isFinite(fillFee) ? fillFee : 0,
            });
          } catch (e) {
            throw new Error(e instanceof Error ? e.message : String(e));
          }
          fillsInserted += 1;
          await upsertPositionAfterBuy(admin, {
            userId: o.user_id,
            executorId: o.executor_id,
            marketId: o.market_id,
            addQty: fillQty,
            price: fillPrice,
          });
          if (String(o.side) === "buy") {
            const notional = Number(o.notional_eur ?? 0);
            const actualFee = Number.isFinite(fillFee) ? fillFee : 0;
            try {
              await applyExecutorTradeBuyDebit(admin, {
                userId: o.user_id,
                executorId: o.executor_id,
                orderId: o.id,
                debitEur: tradeBuyDebitEur(notional, actualFee),
              });
            } catch (ledgerErr) {
              errors.push(
                `order ${o.id}: ledger debit: ${ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)}`,
              );
            }
          }
          const assetName = resolveTradeFillAssetDisplayName(
            assetNameByMarketIdRaw.get(o.market_id),
            marketSymbol,
          );
          if (slackTradeNotifyByExecutor.get(o.executor_id) !== false) {
            await sendTradeFillSlack({
              source: "bitvavo-reconcile",
              side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy",
              assetName,
              executorName: executorNameById.get(o.executor_id) ?? "—",
              exchangeName: slackExchangeNameByExecutorId.get(o.executor_id) ?? "—",
            });
          }
        }
      }

      const statusChanged = String(o.status) !== dbStatus;
      const qtyChanged = qtyUpdate !== prevQty;
      if (statusChanged || qtyChanged) {
        await OrdersSelector.updateById(admin, {
          id: o.id,
          patch: {
            status: dbStatus,
            quantity: qtyUpdate,
            updated_at: new Date().toISOString(),
          },
        });
        updated += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`order ${o.id}: ${msg}`);
    }
  }

  return { ok: true, examined, updated, fillsInserted, errors };
}
