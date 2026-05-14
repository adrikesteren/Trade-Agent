import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapBitvavoOrderStatusToDb } from "@/lib/bitvavo/bitvavo-order-status";
import { placeBitvavoMarketBuyQuote, placeBitvavoMarketSellAmount } from "@/lib/bitvavo/private/place-market-order";
import { bitvavoCredentialsFromExchangeApiFields } from "@/lib/bitvavo/private/signed-request";
import { barsForRetention } from "@/lib/agents/ingest/services/candle-retention.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { closeTimesMatch } from "@/lib/trading/close-time-match";
import {
  fetchAssetDisplayNameByMarketId,
  resolveTradeFillAssetDisplayName,
  sendTradeFillSlack,
} from "@/lib/ops/send-trade-fill-slack";

import {
  ensureDefaultExecutorsForUsers,
  executorAllowedSides,
  executorAllowsMarketAsset,
  fetchExecutorById,
  fetchExecutorsForUsers,
  fetchMarketAssetIds,
  type ExecutorRow,
} from "./executors-lookup.service";
import {
  applyExecutorTradeSellCredit,
  applyExecutorTradeBuyDebit,
  executorPaperFeeEur,
  fetchExecutorEquityEur,
  fetchExecutorPositionSnapshot,
  restoreExecutorPositionSnapshot,
  tradeBuyDebitEur,
  tradeSellCreditEur,
} from "./executor-wallet.service";
import { baseQuantityFromNotionalEur, mergeBuyPositionAvg } from "./paper-fill.service";

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
  /** When set, only this executor is evaluated (used for historical replay). */
  onlyExecutorId?: string | null;
  /** When set, use these user ids instead of the default catalog pipeline users (historical replay). */
  signalUserIdsOverride?: string[] | null;
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

function parseProposedSell(payload: Record<string, unknown> | null): { symbol: string } | null {
  const po = payload?.proposedOrder;
  if (!po || typeof po !== "object") return null;
  const o = po as Record<string, unknown>;
  if (o.side !== "sell") return null;
  const sym = typeof o.symbol === "string" ? o.symbol.trim() : "";
  if (!sym) return null;
  return { symbol: sym };
}

/**
 * Read the position side the mediator stamped on a decision.
 * Falls back to "long" so legacy decisions written before P2 keep working.
 *
 * Looks at `decision_payload.proposedOrder.positionSide` first (per-order detail),
 * then `decision_payload.positionSide` (top-level fallback).
 */
export function parseProposedPositionSide(payload: Record<string, unknown> | null): "long" | "short" {
  if (!payload) return "long";
  const po = payload.proposedOrder;
  if (po && typeof po === "object") {
    const inner = (po as Record<string, unknown>).positionSide;
    if (inner === "short") return "short";
    if (inner === "long") return "long";
  }
  const top = payload.positionSide;
  if (top === "short") return "short";
  return "long";
}

/**
 * Sort key so EXIT-style decisions are processed before ENTER-style decisions
 * for the same (executor, market, bar). Critical for SAR pairs (P3): the EXIT
 * frees up wallet balance / closes the old position before the ENTER on the
 * opposite side tries to spend or open. Lower rank = earlier processing.
 *
 * Ranking is purely lexical — we read `decision_payload.resolvedIntent` and
 * `proposedOrder.side`. SELL or EXIT → 0 (process first); BUY / ENTER → 1.
 */
export function exitFirstRank(payload: Record<string, unknown> | null): 0 | 1 {
  if (!payload) return 1;
  const resolved = typeof payload.resolvedIntent === "string" ? (payload.resolvedIntent as string).toUpperCase() : "";
  if (resolved === "EXIT") return 0;
  const po = payload.proposedOrder;
  if (po && typeof po === "object") {
    const side = (po as Record<string, unknown>).side;
    if (side === "sell") return 0;
  }
  return 1;
}

type DecisionRow = {
  id: string;
  user_id: string;
  signal_id: string;
  approved: boolean;
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
  if (!hit || !Number.isFinite(hit.close) || hit.close <= 0) return null;
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

async function upsertPositionAfterSell(
  admin: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    sellQty: number;
  },
): Promise<void> {
  const { data: pos, error: selErr } = await admin
    .schema("trading")
    .from("positions")
    .select("quantity, avg_price, paper")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  const existingQty = Number(pos?.quantity ?? 0);
  if (!Number.isFinite(existingQty) || existingQty <= 0) return;
  const nextQty = Math.max(0, existingQty - args.sellQty);

  if (nextQty <= 0) {
    const { error: delErr } = await admin
      .schema("trading")
      .from("positions")
      .delete()
      .eq("user_id", args.userId)
      .eq("executor_id", args.executorId)
      .eq("market_id", args.marketId);
    if (delErr) throw new Error(delErr.message);
    return;
  }

  const { error: upErr } = await admin
    .schema("trading")
    .from("positions")
    .update({
      quantity: nextQty,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (upErr) throw new Error(upErr.message);
}

export async function runExecutorCatalogClose(body: ExecutorCatalogCloseBody): Promise<RunExecutorCatalogCloseResult> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSizeVal = Math.min(Math.max(body.marketBatchSize ?? marketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;
  const onlyMarketId = body.onlyMarketId != null && String(body.onlyMarketId).trim() !== "" ? String(body.onlyMarketId).trim() : null;
  const onlyExecutorId =
    body.onlyExecutorId != null && String(body.onlyExecutorId).trim() !== "" ? String(body.onlyExecutorId).trim() : null;

  const override = body.signalUserIdsOverride?.filter((x) => String(x ?? "").trim() !== "") ?? null;
  const userIds = override?.length ? override : await getCatalogPipelineUserIds(admin);

  if (!onlyExecutorId && !userIds.length) {
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

  const quoteNorm = quote != null && String(quote).trim() !== "" ? String(quote).trim().toUpperCase() : null;
  const quoteAssetIdFilter = quoteNorm ? await resolveQuoteAssetId(admin, quoteNorm) : null;
  if (quoteNorm && !quoteAssetIdFilter) {
    return {
      ok: true,
      marketsProcessed: 0,
      ordersInserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "unknown_quote_asset",
    };
  }

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
    if (quoteAssetIdFilter) {
      countQuery = countQuery.eq("quote_asset_id", quoteAssetIdFilter);
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

    const quoteArg = quoteNorm;
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

  let executorRows: ExecutorRow[];
  if (onlyExecutorId) {
    const lone = await fetchExecutorById(admin, onlyExecutorId);
    if (!lone) {
      return {
        ok: true,
        marketsProcessed: 0,
        ordersInserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: "only_executor_not_found",
      };
    }
    await ensureDefaultExecutorsForUsers(admin, [lone.user_id]);
    executorRows = [lone];
  } else {
    if (!userIds.length) {
      return {
        ok: true,
        marketsProcessed: 0,
        ordersInserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: "no_signal_user_ids",
      };
    }
    await ensureDefaultExecutorsForUsers(admin, userIds);
    executorRows = await fetchExecutorsForUsers(admin, userIds);
  }

  const executorsByUser = new Map<string, ExecutorRow[]>();
  for (const uid of userIds) executorsByUser.set(uid, []);
  for (const ex of executorRows) {
    const cur = executorsByUser.get(ex.user_id) ?? [];
    cur.push(ex);
    executorsByUser.set(ex.user_id, cur);
  }

  const catalogExchangeIds = [...new Set(executorRows.map((e) => e.exchange_id).filter(Boolean))];
  const exchangeNameByCatalogId = new Map<string, string>();
  if (catalogExchangeIds.length) {
    const { data: cexRows, error: cexErr } = await admin
      .schema("catalog")
      .from("exchanges")
      .select("id, name, code")
      .in("id", catalogExchangeIds);
    if (cexErr) throw new Error(cexErr.message);
    for (const row of cexRows ?? []) {
      const rid = row.id as string;
      const nm = String((row as { name?: string | null }).name ?? "").trim();
      const code = String((row as { code?: string | null }).code ?? "").trim();
      exchangeNameByCatalogId.set(rid, nm || code || rid);
    }
  }

  const slackExchangeName = (row: ExecutorRow) => exchangeNameByCatalogId.get(row.exchange_id) ?? "—";

  const marketIdsForAssets = rows.map((r) => r.id as string);
  const assetIdByMarket = await fetchMarketAssetIds(admin, marketIdsForAssets);
  const assetNameByMarketIdRaw = await fetchAssetDisplayNameByMarketId(admin, assetIdByMarket);

  let ordersInserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const marketSymbol = m.market_symbol as string;
    const marketAssetId = assetIdByMarket.get(marketId) ?? null;
    const { data: mQuoteRow, error: mqErr } = await admin
      .schema("catalog")
      .from("markets")
      .select("quote_asset_id")
      .eq("id", marketId)
      .maybeSingle();
    if (mqErr) throw new Error(mqErr.message);
    const quoteAssetIdForMarket = mQuoteRow?.quote_asset_id as string | undefined;
    if (!quoteAssetIdForMarket) {
      throw new Error(`${marketSymbol}: market missing quote_asset_id`);
    }
    const assetNameForSlack = resolveTradeFillAssetDisplayName(
      assetNameByMarketIdRaw.get(marketId),
      marketSymbol,
    );

    const executorsThisMarket = onlyExecutorId
      ? executorRows.filter(
          (e) =>
            e.enabled &&
            e.id === onlyExecutorId &&
            executorAllowsMarketAsset(e, marketAssetId) &&
            String(e.exchange_id) === exchangeId,
        )
      : userIds.flatMap((uid) => (executorsByUser.get(uid) ?? []).filter((e) => e.enabled));

    for (const ex of executorsThisMarket) {
      if (ex.execution_mode === "historical" && (!onlyExecutorId || ex.id !== onlyExecutorId)) continue;
      if (!executorAllowsMarketAsset(ex, marketAssetId)) continue;
      if (String(ex.exchange_id) !== exchangeId) continue;

      const ownerId = ex.user_id;

      const barPx = await findClosePriceForBar(admin, { marketId, timeframe, closeTimeIso });
      if (!barPx?.candleId) continue;

      const { data: sigRows, error: sigErr } = await admin
        .schema("trading")
        .from("signals")
        .select("id")
        .eq("user_id", ownerId)
        .eq("candle_id", barPx.candleId);
      if (sigErr) throw new Error(sigErr.message);
      const signalIds = [...new Set((sigRows ?? []).map((r) => String((r as { id: string }).id)))];
      if (!signalIds.length) continue;

      const { data: decList, error: decErr } = await admin
        .schema("trading")
        .from("decisions")
        .select("id, user_id, signal_id, approved, timeframe, decision_payload")
        .eq("user_id", ownerId)
        .eq("executor_id", ex.id)
        .in("signal_id", signalIds);
      if (decErr) throw new Error(decErr.message);

      const candidates = (decList ?? []) as DecisionRow[];
      // P3: process EXIT-style decisions first so SAR pairs sequence wallet /
      // position changes correctly (close old side → free quote balance →
      // open new side). Lexical id is the secondary sort for stable ordering.
      const orderedCandidates = candidates
        .filter(
          (d) =>
            d.approved && (Boolean(parseProposedBuy(d.decision_payload)) || Boolean(parseProposedSell(d.decision_payload))),
        )
        .sort((a, b) => {
          const ra = exitFirstRank(a.decision_payload);
          const rb = exitFirstRank(b.decision_payload);
          if (ra !== rb) return ra - rb;
          return a.id.localeCompare(b.id);
        });
      if (!orderedCandidates.length) continue;

      for (const dec of orderedCandidates) {
      const proposedBuy = parseProposedBuy(dec.decision_payload);
      const proposedSell = parseProposedSell(dec.decision_payload);
      if (!proposedBuy && !proposedSell) continue;

      // P2 sides framework — gate on the position side stamped by the mediator.
      // Two reasons to reject without ever placing an order:
      //   1. side_not_allowed              — executor.allowed_sides excludes it
      //   2. short_execution_not_implemented — short path is framework-only in P2
      // We still write a `status=rejected` order row (matching the credentials /
      // insufficient-balance pattern above) so the UI can show that the executor
      // saw the decision and chose not to place anything.
      const decisionPositionSide = parseProposedPositionSide(dec.decision_payload);
      const allowedSides = executorAllowedSides(ex);
      if (!allowedSides.includes(decisionPositionSide)) {
        const inferredSide = proposedSell ? "sell" : "buy";
        const inferredNotional = proposedBuy?.notionalEur ?? 0;
        const { error: rejErr } = await admin.schema("trading").from("orders").insert({
          user_id: ownerId,
          executor_id: ex.id,
          decision_id: dec.id,
          side: inferredSide,
          quantity: 0,
          notional_eur: inferredNotional,
          status: "rejected",
          paper: ex.execution_mode !== "live",
          position_side: decisionPositionSide,
          external_id: null,
        });
        if (rejErr && !/duplicate|unique/i.test(rejErr.message)) {
          throw new Error(`${marketSymbol}: side_not_allowed reject insert: ${rejErr.message}`);
        }
        continue;
      }
      if (decisionPositionSide === "short") {
        const { error: rejShortErr } = await admin.schema("trading").from("orders").insert({
          user_id: ownerId,
          executor_id: ex.id,
          decision_id: dec.id,
          side: proposedSell ? "sell" : "buy",
          quantity: 0,
          notional_eur: proposedBuy?.notionalEur ?? 0,
          status: "rejected",
          paper: ex.execution_mode !== "live",
          position_side: "short",
          external_id: null,
        });
        if (rejShortErr && !/duplicate|unique/i.test(rejShortErr.message)) {
          throw new Error(
            `${marketSymbol}: short_execution_not_implemented reject insert: ${rejShortErr.message}`,
          );
        }
        continue;
      }

        const { data: existingOrder, error: ordSelErr } = await admin
          .schema("trading")
          .from("orders")
          .select("id")
          .eq("decision_id", dec.id)
          .maybeSingle();
        if (ordSelErr) throw new Error(ordSelErr.message);
        if (existingOrder) continue;

        const paperExecution = ex.execution_mode !== "live";
        const orderSide = proposedSell ? "sell" : "buy";
        const notionalEur = proposedBuy?.notionalEur ?? 0;

        if (paperExecution && orderSide === "buy") {
          if (!barPx || !Number.isFinite(barPx.price) || barPx.price <= 0) continue;
          const px = barPx;

          const qty = baseQuantityFromNotionalEur(notionalEur, px.price);
          if (!Number.isFinite(qty) || qty <= 0) continue;

          const feeEur = executorPaperFeeEur(notionalEur);
          const debitEur = tradeBuyDebitEur(notionalEur, feeEur);
          const equityPre = await fetchExecutorEquityEur(admin, {
            userId: ownerId,
            executorId: ex.id,
            quoteAssetId: quoteAssetIdForMarket,
          });
          if (equityPre < debitEur) continue;

          const posSnapshot = await fetchExecutorPositionSnapshot(admin, {
            userId: ownerId,
            executorId: ex.id,
            marketId,
          });

          const { data: inserted, error: insOrdErr } = await admin
            .schema("trading")
            .from("orders")
            .insert({
              user_id: ownerId,
              executor_id: ex.id,
              decision_id: dec.id,
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
            user_id: ownerId,
            order_id: orderId,
            price: px.price,
            quantity: qty,
            fee: feeEur,
          });
          if (fillErr) throw new Error(`${marketSymbol}: fill insert: ${fillErr.message}`);

          try {
            await upsertPositionAfterBuy(admin, {
              userId: ownerId,
              executorId: ex.id,
              marketId,
              paper: paperExecution,
              addQty: qty,
              price: px.price,
            });
            await applyExecutorTradeBuyDebit(admin, {
              userId: ownerId,
              executorId: ex.id,
              orderId,
              debitEur,
            });
          } catch (e) {
            await admin.schema("trading").from("orders").delete().eq("id", orderId);
            await restoreExecutorPositionSnapshot(admin, {
              userId: ownerId,
              executorId: ex.id,
              marketId,
              snapshot: posSnapshot,
            });
            throw e;
          }
          if (ex.slack_trade_notifications_enabled && ex.execution_mode !== "historical") {
            await sendTradeFillSlack({
              source: "executor-catalog-close",
              side: "buy",
              assetName: assetNameForSlack,
              executorName: String(ex.name ?? "").trim() || "—",
              exchangeName: slackExchangeName(ex),
            });
          }
          ordersInserted += 1;
          continue;
        }

        if (paperExecution && orderSide === "sell") {
          if (!barPx || !Number.isFinite(barPx.price) || barPx.price <= 0) continue;
          const px = barPx;

          const posSnapshot = await fetchExecutorPositionSnapshot(admin, {
            userId: ownerId,
            executorId: ex.id,
            marketId,
          });
          const sellQty = Number(posSnapshot?.quantity ?? 0);
          if (!Number.isFinite(sellQty) || sellQty <= 0) continue;

          const grossNotional = sellQty * px.price;
          const feeEur = executorPaperFeeEur(grossNotional);
          const creditEur = tradeSellCreditEur(grossNotional, feeEur);
          if (!Number.isFinite(creditEur) || creditEur <= 0) continue;

          const { data: inserted, error: insOrdErr } = await admin
            .schema("trading")
            .from("orders")
            .insert({
              user_id: ownerId,
              executor_id: ex.id,
              decision_id: dec.id,
              side: "sell",
              quantity: sellQty,
              notional_eur: grossNotional,
              status: "filled",
              paper: paperExecution,
              external_id: null,
            })
            .select("id")
            .single();
          if (insOrdErr) throw new Error(`${marketSymbol}: sell order insert: ${insOrdErr.message}`);
          const orderId = inserted?.id as string;

          const { error: fillErr } = await admin.schema("trading").from("fills").insert({
            user_id: ownerId,
            order_id: orderId,
            price: px.price,
            quantity: sellQty,
            fee: feeEur,
          });
          if (fillErr) throw new Error(`${marketSymbol}: sell fill insert: ${fillErr.message}`);

          try {
            await upsertPositionAfterSell(admin, {
              userId: ownerId,
              executorId: ex.id,
              marketId,
              sellQty,
            });
            await applyExecutorTradeSellCredit(admin, {
              userId: ownerId,
              executorId: ex.id,
              orderId,
              creditEur,
            });
            await admin
              .schema("trading")
              .from("executor_moving_floors")
              .delete()
              .eq("user_id", ownerId)
              .eq("executor_id", ex.id)
              .eq("market_id", marketId);
          } catch (e) {
            await admin.schema("trading").from("orders").delete().eq("id", orderId);
            await restoreExecutorPositionSnapshot(admin, {
              userId: ownerId,
              executorId: ex.id,
              marketId,
              snapshot: posSnapshot,
            });
            throw e;
          }
          if (ex.slack_trade_notifications_enabled && ex.execution_mode !== "historical") {
            await sendTradeFillSlack({
              source: "executor-catalog-close",
              side: "sell",
              assetName: assetNameForSlack,
              executorName: String(ex.name ?? "").trim() || "—",
              exchangeName: slackExchangeName(ex),
            });
          }
          ordersInserted += 1;
          continue;
        }

        /* Live */
        try {
          const bitvavoCreds = bitvavoCredentialsFromExchangeApiFields(ex.exchange_api_key, ex.exchange_api_secret);
          if (!bitvavoCreds) {
            const { error: credRejErr } = await admin.schema("trading").from("orders").insert({
              user_id: ownerId,
              executor_id: ex.id,
              decision_id: dec.id,
              side: orderSide,
              quantity: 0,
              notional_eur: notionalEur,
              status: "rejected",
              paper: false,
              external_id: null,
            });
            if (credRejErr && !/duplicate|unique/i.test(credRejErr.message)) {
              throw new Error(`${marketSymbol}: missing API credentials reject insert: ${credRejErr.message}`);
            }
            console.error(
              `${marketSymbol}: live order skipped — set exchange_api_key and exchange_api_secret on executor ${ex.id}`,
            );
            continue;
          }

          if (orderSide === "buy") {
            const estFee = executorPaperFeeEur(notionalEur);
            const estDebit = tradeBuyDebitEur(notionalEur, estFee);
            const liveEquity = await fetchExecutorEquityEur(admin, {
              userId: ownerId,
              executorId: ex.id,
              quoteAssetId: quoteAssetIdForMarket,
            });
            if (liveEquity < estDebit) {
              const { error: skipInsErr } = await admin.schema("trading").from("orders").insert({
                user_id: ownerId,
                executor_id: ex.id,
                decision_id: dec.id,
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
          }

          let sellQtyRequested = 0;
          if (orderSide === "sell") {
            const pos = await fetchExecutorPositionSnapshot(admin, { userId: ownerId, executorId: ex.id, marketId });
            sellQtyRequested = Number(pos?.quantity ?? 0);
            if (!Number.isFinite(sellQtyRequested) || sellQtyRequested <= 0) continue;
          }

          const live =
            orderSide === "buy"
              ? await placeBitvavoMarketBuyQuote({
                  credentials: bitvavoCreds,
                  market: marketSymbol,
                  amountQuoteEur: notionalEur,
                  clientOrderId: dec.id,
                })
              : await placeBitvavoMarketSellAmount({
                  credentials: bitvavoCreds,
                  market: marketSymbol,
                  amountBase: sellQtyRequested,
                  clientOrderId: dec.id,
                });
          const dbStatus = mapBitvavoOrderStatusToDb(live.status);
          const { data: insLive, error: insLiveErr } = await admin
            .schema("trading")
            .from("orders")
            .insert({
              user_id: ownerId,
              executor_id: ex.id,
              decision_id: dec.id,
              side: orderSide,
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
                orderSide === "buy" && Number.isFinite(fillQty) && fillQty > 0
                  ? notionalEur / fillQty
                  : Number(live.raw.price ?? Number.NaN);
            }
            if (Number.isFinite(fillPrice) && Number.isFinite(fillQty) && fillQty > 0) {
              await admin.schema("trading").from("fills").insert({
                user_id: ownerId,
                order_id: localOrderId,
                price: fillPrice,
                quantity: fillQty,
                fee: Number.isFinite(fillFee) ? fillFee : 0,
              });
              if (orderSide === "buy") {
                await upsertPositionAfterBuy(admin, {
                  userId: ownerId,
                  executorId: ex.id,
                  marketId,
                  paper: paperExecution,
                  addQty: fillQty,
                  price: fillPrice,
                });
              } else {
                await upsertPositionAfterSell(admin, {
                  userId: ownerId,
                  executorId: ex.id,
                  marketId,
                  sellQty: fillQty,
                });
              }
              await admin
                .schema("trading")
                .from("orders")
                .update({ quantity: fillQty, updated_at: new Date().toISOString() })
                .eq("id", localOrderId);
              try {
                if (orderSide === "buy") {
                  const debitLive = tradeBuyDebitEur(notionalEur, Number.isFinite(fillFee) ? fillFee : 0);
                  await applyExecutorTradeBuyDebit(admin, {
                    userId: ownerId,
                    executorId: ex.id,
                    orderId: localOrderId,
                    debitEur: debitLive,
                  });
                } else {
                  const grossNotional = fillPrice * fillQty;
                  const creditLive = tradeSellCreditEur(grossNotional, Number.isFinite(fillFee) ? fillFee : 0);
                  await applyExecutorTradeSellCredit(admin, {
                    userId: ownerId,
                    executorId: ex.id,
                    orderId: localOrderId,
                    creditEur: creditLive,
                  });
                  await admin
                    .schema("trading")
                    .from("executor_moving_floors")
                    .delete()
                    .eq("user_id", ownerId)
                    .eq("executor_id", ex.id)
                    .eq("market_id", marketId);
                }
              } catch (ledgerErr) {
                console.error(`${marketSymbol}: live fill ledger update failed`, ledgerErr);
              }
              if (ex.slack_trade_notifications_enabled && ex.execution_mode !== "historical") {
                await sendTradeFillSlack({
                  source: "executor-catalog-close",
                  side: orderSide,
                  assetName: assetNameForSlack,
                  executorName: String(ex.name ?? "").trim() || "—",
                  exchangeName: slackExchangeName(ex),
                });
              }
            }
          }
          ordersInserted += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const { error: rejErr } = await admin.schema("trading").from("orders").insert({
            user_id: ownerId,
            executor_id: ex.id,
            decision_id: dec.id,
            side: orderSide,
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
      } // end for (const dec of orderedCandidates)
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
