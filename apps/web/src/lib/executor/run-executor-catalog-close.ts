import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapBitvavoOrderStatusToDb } from "@/lib/bitvavo/bitvavo-order-status";
import { placeBitvavoMarketBuyQuote } from "@/lib/bitvavo/place-market-order";
import { barsForRetention } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { closeTimesMatch } from "@/lib/trading/close-time-match";
import {
  ensureDefaultExecutorsForUsers,
  executorAllowsMarketAsset,
  fetchExecutorsForUsers,
  fetchMarketAssetIds,
  type ExecutorRow,
} from "@/lib/trading/executors";
import {
  applyExecutorTradeBuyDebit,
  executorPaperFeeEur,
  fetchExecutorEquityEur,
  fetchExecutorPositionSnapshot,
  restoreExecutorPositionSnapshot,
  tradeBuyDebitEur,
} from "@/lib/trading/executor-wallet";
import { sendTradeFillSlack } from "@/lib/ops/send-trade-fill-slack";

import { baseQuantityFromNotionalEur, mergeBuyPositionAvg } from "./paper-fill";

export type ExecutorCatalogCloseBody = {
  closeTimeIso: string;
  timeframe?: string;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  mediatorSyncRunId?: string | null;
  /** `automation.sync_runs.id` for this executor_catalog_close job (set by the sync-run orchestrator). */
  executorPipelineSyncRunId?: string | null;
  /** When set, process only this `catalog.markets.id` (single batch; Bitvavo catalog-close only). */
  onlyMarketId?: string | null;
  /** Reserved for API parity with signals/mediator (executor does not enqueue downstream jobs). */
  disableDownstreamEnqueue?: boolean;
};

export type RunExecutorCatalogCloseResult = {
  ok: true;
  marketsProcessed: number;
  ordersInserted: number;
  nextMarketOffset: number | null;
  totalMarkets: number;
  skippedReason?: string;
};

function marketBatchSize(): number {
  const n = Number(process.env.SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

function maxTotalMarkets(): number | null {
  const raw = process.env.SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

type CandleRow = {
  id: string;
  close: string | number;
  candle_timestamps: { close_time: string; open_time: string } | { close_time: string; open_time: string }[] | null;
};

function mapCandleRows(rows: CandleRow[]): { id: string; close: number; closeTimeIso: string }[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return { id: r.id, close: Number(r.close), closeTimeIso: closeTime };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function fetchCandlesForMarket(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; barLimit: number },
): Promise<CandleRow[]> {
  const { data, error } = await admin
    .schema("catalog")
    .from("candles")
    .select("id, open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .limit(args.barLimit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleRow[];
}

function parseProposedBuy(payload: Record<string, unknown> | null): { symbol: string; notionalEur: number } | null {
  const po = payload?.proposedOrder;
  if (!po || typeof po !== "object") return null;
  const o = po as Record<string, unknown>;
  if (o.side !== "buy") return null;
  const sym = typeof o.symbol === "string" ? o.symbol.trim() : "";
  const n = Number(o.notionalEur);
  if (!sym || !Number.isFinite(n) || n <= 0) return null;
  return { symbol: sym, notionalEur: n };
}

type DecisionRow = {
  id: string;
  user_id: string;
  market_id: string;
  approved: boolean;
  close_time: string;
  timeframe: string;
  decision_payload: Record<string, unknown> | null;
};

async function findClosePriceForBar(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeIso: string },
): Promise<{ price: number; candleId: string | null } | null> {
  const raw = await fetchCandlesForMarket(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    barLimit: barsForRetention(args.timeframe),
  });
  const sorted = mapCandleRows(raw);
  const hit = sorted.find((r) => closeTimesMatch(r.closeTimeIso, args.closeTimeIso));
  if (!hit) return null;
  return { price: hit.close, candleId: hit.id };
}

async function upsertPositionAfterBuy(
  admin: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    paper: boolean;
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
    paper: args.paper,
    quantity,
    avg_price: avgPrice,
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await admin.schema("trading").from("positions").upsert(row, {
    onConflict: "user_id,executor_id,market_id",
  });
  if (upErr) throw new Error(`positions upsert: ${upErr.message}`);
}

export async function runExecutorCatalogClose(body: ExecutorCatalogCloseBody): Promise<RunExecutorCatalogCloseResult> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSizeVal = Math.min(Math.max(body.marketBatchSize ?? marketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;
  const onlyMarketId = body.onlyMarketId != null && String(body.onlyMarketId).trim() !== "" ? String(body.onlyMarketId).trim() : null;

  const userIds = parseSignalUserIdsFromEnv();
  if (!userIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      ordersInserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "no_signal_user_ids",
    };
  }

  const { data: ex, error: exErr } = await admin.schema("catalog").from("exchanges").select("id").eq("code", "bitvavo").single();
  if (exErr || !ex) throw new Error("Bitvavo exchange not found");
  const exchangeId = ex.id as string;

  let effectiveTotal: number;
  let rows: { id: string; market_symbol: string }[];

  if (onlyMarketId) {
    const { data: mrow, error: oneErr } = await admin
      .schema("catalog")
      .from("markets")
      .select("id, market_symbol, exchange_id")
      .eq("id", onlyMarketId)
      .maybeSingle();
    if (oneErr) throw new Error(oneErr.message);
    if (!mrow) {
      return {
        ok: true,
        marketsProcessed: 0,
        ordersInserted: 0,
        nextMarketOffset: null,
        totalMarkets: 0,
        skippedReason: "only_market_not_found",
      };
    }
    if (String(mrow.exchange_id) !== exchangeId) {
      throw new Error("executor_catalog_close: onlyMarketId must be a Bitvavo catalog market");
    }
    effectiveTotal = 1;
    rows = [{ id: mrow.id as string, market_symbol: String(mrow.market_symbol) }];
    if (marketOffset > 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        ordersInserted: 0,
        nextMarketOffset: null,
        totalMarkets: 1,
        skippedReason: "market_offset_past_end",
      };
    }
  } else {
    let countQuery = admin
      .schema("catalog")
      .from("markets")
      .select("id", { count: "exact", head: true })
      .eq("exchange_id", exchangeId);
    if (quote != null && String(quote).trim() !== "") {
      countQuery = countQuery.eq("quote_code", String(quote).trim().toUpperCase());
    }
    const { count: totalMarkets, error: countErr } = await countQuery;
    if (countErr) throw new Error(countErr.message);
    const total = totalMarkets ?? 0;
    const maxTotal = maxTotalMarkets();
    effectiveTotal = maxTotal != null ? Math.min(total, maxTotal) : total;

    if (marketOffset >= effectiveTotal || effectiveTotal === 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        ordersInserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: marketOffset >= effectiveTotal ? "market_offset_past_end" : undefined,
      };
    }

    const quoteArg = quote != null && String(quote).trim() !== "" ? String(quote).trim().toUpperCase() : null;
    const { data: markets, error: listErr } = await admin.schema("catalog").rpc("bitvavo_markets_for_candle_sync_slice", {
      p_exchange_id: exchangeId,
      p_quote: quoteArg,
      p_offset: marketOffset,
      p_limit: marketBatchSizeVal,
    });
    if (listErr) throw new Error(listErr.message);
    const rowsRaw = (markets ?? []) as { id: string; market_symbol: string }[];
    const remainingBudget = Math.max(effectiveTotal - marketOffset, 0);
    rows = remainingBudget < rowsRaw.length ? rowsRaw.slice(0, remainingBudget) : rowsRaw;
  }

  if (rows.length === 0) {
    return {
      ok: true,
      marketsProcessed: 0,
      ordersInserted: 0,
      nextMarketOffset: null,
      totalMarkets: effectiveTotal,
      skippedReason: "no_market_rows",
    };
  }

  const t = Date.parse(closeTimeIso);
  const closeLow = Number.isFinite(t) ? new Date(t - 2000).toISOString() : closeTimeIso;
  const closeHigh = Number.isFinite(t) ? new Date(t + 2000).toISOString() : closeTimeIso;

  await ensureDefaultExecutorsForUsers(admin, userIds);
  const executorRows = await fetchExecutorsForUsers(admin, userIds);
  const executorsByUser = new Map<string, ExecutorRow[]>();
  for (const uid of userIds) executorsByUser.set(uid, []);
  for (const ex of executorRows) {
    const cur = executorsByUser.get(ex.user_id) ?? [];
    cur.push(ex);
    executorsByUser.set(ex.user_id, cur);
  }

  const marketIdsForAssets = rows.map((r) => r.id as string);
  const assetIdByMarket = await fetchMarketAssetIds(admin, marketIdsForAssets);

  let ordersInserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const marketSymbol = m.market_symbol as string;
    const marketAssetId = assetIdByMarket.get(marketId) ?? null;

    for (const userId of userIds) {
      const executors = (executorsByUser.get(userId) ?? []).filter((e) => e.enabled);

      for (const ex of executors) {
        if (!executorAllowsMarketAsset(ex, marketAssetId)) continue;

        const { data: decList, error: decErr } = await admin
          .schema("trading")
          .from("trade_decisions")
          .select("id, user_id, market_id, approved, close_time, timeframe, decision_payload")
          .eq("user_id", userId)
          .eq("executor_id", ex.id)
          .eq("market_id", marketId)
          .eq("timeframe", timeframe)
          .gte("close_time", closeLow)
          .lte("close_time", closeHigh);

        if (decErr) throw new Error(decErr.message);

        const decisions = ((decList ?? []) as DecisionRow[]).filter((d) => closeTimesMatch(d.close_time, closeTimeIso));
        const dec = decisions[0];
        if (!dec) continue;
        if (!dec.approved) continue;

        const proposed = parseProposedBuy(dec.decision_payload);
        if (!proposed) continue;

        const { data: existingOrder, error: ordSelErr } = await admin
          .schema("trading")
          .from("orders")
          .select("id")
          .eq("decision_id", dec.id)
          .maybeSingle();
        if (ordSelErr) throw new Error(ordSelErr.message);
        if (existingOrder) continue;

        const paperExecution = ex.execution_mode !== "live";
        const notionalEur = proposed.notionalEur;

        if (paperExecution) {
          const px = await findClosePriceForBar(admin, { marketId, timeframe, closeTimeIso });
          if (!px || !Number.isFinite(px.price) || px.price <= 0) continue;

          const qty = baseQuantityFromNotionalEur(notionalEur, px.price);
          if (!Number.isFinite(qty) || qty <= 0) continue;

          const feeEur = executorPaperFeeEur(notionalEur);
          const debitEur = tradeBuyDebitEur(notionalEur, feeEur);
          const equityPre = await fetchExecutorEquityEur(admin, { userId, executorId: ex.id });
          if (equityPre < debitEur) continue;

          const posSnapshot = await fetchExecutorPositionSnapshot(admin, {
            userId,
            executorId: ex.id,
            marketId,
          });

          const { data: inserted, error: insOrdErr } = await admin
            .schema("trading")
            .from("orders")
            .insert({
              user_id: userId,
              executor_id: ex.id,
              decision_id: dec.id,
              market_id: marketId,
              side: "buy",
              quantity: qty,
              notional_eur: notionalEur,
              status: "filled",
              paper: paperExecution,
              external_id: null,
            })
            .select("id")
            .single();
          if (insOrdErr) throw new Error(`${marketSymbol}: order insert: ${insOrdErr.message}`);
          const orderId = inserted?.id as string;

          const { error: fillErr } = await admin.schema("trading").from("fills").insert({
            user_id: userId,
            order_id: orderId,
            price: px.price,
            quantity: qty,
            fee: feeEur,
          });
          if (fillErr) throw new Error(`${marketSymbol}: fill insert: ${fillErr.message}`);

          try {
            await upsertPositionAfterBuy(admin, {
              userId,
              executorId: ex.id,
              marketId,
              paper: paperExecution,
              addQty: qty,
              price: px.price,
            });
            await applyExecutorTradeBuyDebit(admin, {
              userId,
              executorId: ex.id,
              orderId,
              debitEur,
            });
          } catch (e) {
            await admin.schema("trading").from("orders").delete().eq("id", orderId);
            await restoreExecutorPositionSnapshot(admin, {
              userId,
              executorId: ex.id,
              marketId,
              snapshot: posSnapshot,
            });
            throw e;
          }
          await sendTradeFillSlack({
            source: "executor-catalog-close",
            side: "buy",
            executorName: ex.name,
            executorId: ex.id,
            marketSymbol,
            quantity: qty,
            price: px.price,
            fee: feeEur,
            executionMode: ex.execution_mode,
            paper: true,
            orderId,
          });
          ordersInserted += 1;
          continue;
        }

        /* Live */
        try {
          const estFee = executorPaperFeeEur(notionalEur);
          const estDebit = tradeBuyDebitEur(notionalEur, estFee);
          const liveEquity = await fetchExecutorEquityEur(admin, { userId, executorId: ex.id });
          if (liveEquity < estDebit) {
            const { error: skipInsErr } = await admin.schema("trading").from("orders").insert({
              user_id: userId,
              executor_id: ex.id,
              decision_id: dec.id,
              market_id: marketId,
              side: "buy",
              quantity: 0,
              notional_eur: notionalEur,
              status: "rejected",
              paper: false,
              external_id: null,
            });
            if (skipInsErr && !/duplicate|unique/i.test(skipInsErr.message)) {
              throw new Error(`${marketSymbol}: insufficient balance reject insert: ${skipInsErr.message}`);
            }
            continue;
          }

          const live = await placeBitvavoMarketBuyQuote({
            market: marketSymbol,
            amountQuoteEur: notionalEur,
            clientOrderId: dec.id,
          });
          const dbStatus = mapBitvavoOrderStatusToDb(live.status);
          const { data: insLive, error: insLiveErr } = await admin
            .schema("trading")
            .from("orders")
            .insert({
              user_id: userId,
              executor_id: ex.id,
              decision_id: dec.id,
              market_id: marketId,
              side: "buy",
              quantity: 0,
              notional_eur: notionalEur,
              status: dbStatus,
              paper: false,
              external_id: live.orderId,
            })
            .select("id")
            .single();
          if (insLiveErr) throw new Error(`${marketSymbol}: live order insert: ${insLiveErr.message}`);
          const localOrderId = insLive?.id as string;

          const fills = live.raw.fills;
          if (dbStatus === "filled") {
            let fillPrice = Number.NaN;
            let fillQty = Number.NaN;
            let fillFee = 0;
            if (Array.isArray(fills) && fills.length > 0) {
              const f0 = fills[0] as Record<string, unknown>;
              fillPrice = Number(f0.price);
              fillQty = Number(f0.amount);
              fillFee = Number(f0.fee ?? 0);
            } else {
              fillQty = Number(live.raw.filledAmount ?? Number.NaN);
              fillPrice =
                Number.isFinite(fillQty) && fillQty > 0
                  ? notionalEur / fillQty
                  : Number(live.raw.price ?? Number.NaN);
            }
            if (Number.isFinite(fillPrice) && Number.isFinite(fillQty) && fillQty > 0) {
              await admin.schema("trading").from("fills").insert({
                user_id: userId,
                order_id: localOrderId,
                price: fillPrice,
                quantity: fillQty,
                fee: Number.isFinite(fillFee) ? fillFee : 0,
              });
              await upsertPositionAfterBuy(admin, {
                userId,
                executorId: ex.id,
                marketId,
                paper: paperExecution,
                addQty: fillQty,
                price: fillPrice,
              });
              await admin
                .schema("trading")
                .from("orders")
                .update({ quantity: fillQty, updated_at: new Date().toISOString() })
                .eq("id", localOrderId);
              const debitLive = tradeBuyDebitEur(notionalEur, Number.isFinite(fillFee) ? fillFee : 0);
              let ledgerDebitFailed = false;
              try {
                await applyExecutorTradeBuyDebit(admin, {
                  userId,
                  executorId: ex.id,
                  orderId: localOrderId,
                  debitEur: debitLive,
                });
              } catch (ledgerErr) {
                ledgerDebitFailed = true;
                console.error(`${marketSymbol}: live fill debit failed`, ledgerErr);
              }
              await sendTradeFillSlack({
                source: "executor-catalog-close",
                side: "buy",
                executorName: ex.name,
                executorId: ex.id,
                marketSymbol,
                quantity: fillQty,
                price: fillPrice,
                fee: Number.isFinite(fillFee) ? fillFee : 0,
                executionMode: ex.execution_mode,
                paper: false,
                orderId: localOrderId,
                ledgerDebitFailed,
              });
            }
          }
          ordersInserted += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const { error: rejErr } = await admin.schema("trading").from("orders").insert({
            user_id: userId,
            executor_id: ex.id,
            decision_id: dec.id,
            market_id: marketId,
            side: "buy",
            quantity: 0,
            notional_eur: notionalEur,
            status: "rejected",
            paper: false,
            external_id: null,
          });
          if (rejErr && !/duplicate|unique/i.test(rejErr.message)) {
            throw new Error(`${marketSymbol}: live reject insert: ${rejErr.message}`);
          }
          console.error(`executor live order failed ${marketSymbol}:`, msg);
        }
      }
    }
  }

  const nextOffset = onlyMarketId ? 1 : marketOffset + rows.length;
  const nextMarketOffset = nextOffset < effectiveTotal ? nextOffset : null;

  return {
    ok: true,
    marketsProcessed: rows.length,
    ordersInserted,
    nextMarketOffset,
    totalMarkets: effectiveTotal,
  };
}

export async function runExecutorCatalogCloseDrain(body: ExecutorCatalogCloseBody): Promise<RunExecutorCatalogCloseResult> {
  let offset = body.marketOffset ?? 0;
  let totalOrders = 0;
  let totalMarkets = 0;
  let last: RunExecutorCatalogCloseResult | null = null;
  const maxIters = Number(process.env.SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS ?? 400);
  const cap = Math.min(Math.max(Math.floor(maxIters), 1), 2000);

  let marketsSum = 0;
  for (let i = 0; i < cap; i++) {
    last = await runExecutorCatalogClose({ ...body, marketOffset: offset });
    totalMarkets = last.totalMarkets;
    totalOrders += last.ordersInserted;
    marketsSum += last.marketsProcessed;
    if (last.nextMarketOffset == null) break;
    offset = last.nextMarketOffset;
  }

  return {
    ok: true,
    marketsProcessed: marketsSum,
    ordersInserted: totalOrders,
    nextMarketOffset: last?.nextMarketOffset ?? null,
    totalMarkets,
  };
}
