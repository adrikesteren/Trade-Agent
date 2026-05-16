"use server";

import { revalidatePath } from "next/cache";

import { executeMarketEvaluateAllSignalsWithSyncRun } from "@/lib/agents/signal/services/market-evaluate-all-signals-with-sync-run.service";
import { deleteAllSignalsForMarket } from "@/lib/agents/signal/services/market-signals-delete.service";
import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { runMarketBackfillCandles, todayUtcYmd } from "@/lib/orchestrators/market-backfill-candles.service";
import { publishMarketBackfillCandlesChunkedRelay } from "@/lib/relay/publish-market-backfill-candles-chunked.service";
import { publishMarketEvaluateAllSignalsChunkedRelay } from "@/lib/relay/publish-market-evaluate-all-signals-chunked.service";
import {
  buildSymbolClosePipelineUrl,
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  normalizeRelayBaseUrl,
  postRelaySingleMessage,
  relayMaxRetries,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type EnqueueMarketSymbolCloseRelayResult =
  | { ok: true; relayMessageId: string }
  | { ok: false; error: string };

/**
 * Enqueues one `POST /api/v1/messages` on Relay targeting this app’s `symbol-close-pipeline` worker for the market’s base asset + exchange + quote.
 */
export async function enqueueMarketSymbolCloseRelay(marketId: string): Promise<EnqueueMarketSymbolCloseRelayResult> {
  const trimmedId = marketId.trim();
  if (!trimmedId) {
    return { ok: false, error: "Market id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: market, error } = await supabase
    .schema("catalog")
    .from("markets")
    .select(
      `
      quote_asset_id,
      assets!markets_asset_id_fkey ( code ),
      exchanges ( code )
    `,
    )
    .eq("id", trimmedId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!market) {
    return { ok: false, error: "Market not found." };
  }

  const rawA = market.assets as unknown;
  const rawE = market.exchanges as unknown;
  const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as { code?: string } | null;
  const ex = (Array.isArray(rawE) ? rawE[0] : rawE) as { code?: string } | null;

  const assetCode = String(asset?.code ?? "").trim();
  const exchangeCode = String(ex?.code ?? "").trim();
  if (!assetCode || !exchangeCode) {
    return { ok: false, error: "Market is missing base asset or exchange code." };
  }

  const qid = String(market.quote_asset_id ?? "").trim();
  if (!qid) {
    return { ok: false, error: "Market is missing quote_asset_id." };
  }

  const { data: quoteRow, error: qErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("id", qid)
    .maybeSingle();
  if (qErr) {
    return { ok: false, error: qErr.message };
  }
  const quote = String(quoteRow?.code ?? "").trim().toUpperCase();
  if (!quote) {
    return { ok: false, error: "Quote asset not found for this market." };
  }

  try {
    const relayBase = normalizeRelayBaseUrl();
    const appBase = getAppBaseUrl();
    const url = buildSymbolClosePipelineUrl(appBase, assetCode, exchangeCode, quote);
    const relayMessageId = await postRelaySingleMessage(
      relayBase,
      url,
      await downstreamWorkerHeaders(),
      relayMaxRetries(),
    );
    return { ok: true, relayMessageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EnqueueMarketBackfillCandlesResult =
  | {
      ok: true;
      /** True when handed off to Relay; false when the worker ran inline (no Relay env). */
      queued: boolean;
      /**
       * Number of Relay messages published. Only set when `queued === true`. ≥ 2 means a
       * sequential Relay message group; 1 means a single Relay message (covered by
       * `relayMessageId` for backwards compatibility).
       */
      chunkCount?: number;
      /** Set when ≥ 2 chunks were published. */
      relayMessageGroupId?: string | null;
      /** Set when exactly 1 chunk was published (backwards compatible). */
      relayMessageId?: string;
      /** Inline result fields (only when `queued === false`). */
      candleRowsUpserted?: number;
      barsReplayed?: number;
      signalsUpsertedTotal?: number;
    }
  | { ok: false; error: string };

/**
 * Backfill candles for one market over a UTC window:
 * - Ingest Agent: pulls Bitvavo OHLCV in 1440-bar batches into `catalog.candles`.
 * - Signal Agent: upserts `trading.signals` for every closed bar in the window.
 *
 * When Relay is configured ({@link isRelayWorkerEnqueueConfigured}) the work is split
 * into UTC day chunks (default 30 days each) and published as a Relay message group
 * via {@link publishMarketBackfillCandlesChunkedRelay} so each chunk gets its own
 * timeout / retry budget and partial progress survives a single failure. With one
 * chunk the publisher falls back to a single message. The historical executor `Run`
 * path intentionally still uses single Relay messages — see
 * `apps/web/src/app/api/executors/[id]/historical-run/route.ts`.
 *
 * Without Relay configured the orchestrator runs inline once.
 */
export async function enqueueMarketBackfillCandlesViaRelay(args: {
  marketId: string;
  startDate: string;
  endDate?: string | null;
}): Promise<EnqueueMarketBackfillCandlesResult> {
  const marketId = args.marketId.trim();
  const startDate = args.startDate.trim();
  const rawEnd = (args.endDate ?? "").trim();
  const endDate = rawEnd || todayUtcYmd();

  if (!marketId) {
    return { ok: false, error: "Market id is required." };
  }
  if (!ISO_DATE_RE.test(startDate)) {
    return { ok: false, error: "Start date must be a YYYY-MM-DD UTC date." };
  }
  if (!ISO_DATE_RE.test(endDate)) {
    return { ok: false, error: "End date must be a YYYY-MM-DD UTC date." };
  }
  if (startDate > endDate) {
    return { ok: false, error: "Start date must be on or before end date." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    if (await isRelayWorkerEnqueueConfigured()) {
      const relayBase = normalizeRelayBaseUrl();
      const appBase = getAppBaseUrl();
      const published = await publishMarketBackfillCandlesChunkedRelay({
        relayBase,
        appBase,
        marketId,
        startDate,
        endDate,
      });
      if (!published.ok) {
        return { ok: false, error: published.error };
      }
      const chunkCount = published.messageIds.length;
      return {
        ok: true,
        queued: true,
        chunkCount,
        ...(chunkCount === 1
          ? { relayMessageId: published.messageIds[0] }
          : { relayMessageGroupId: published.groupId }),
      };
    }

    const admin = createServiceRoleClient();
    const result = await runMarketBackfillCandles(admin, { marketId, startDate, endDate });
    revalidatePath(`/markets/${marketId}`);
    revalidatePath("/signals");
    return {
      ok: true,
      queued: false,
      candleRowsUpserted: result.candleRowsUpserted,
      barsReplayed: result.barsReplayed,
      signalsUpsertedTotal: result.signalsUpsertedTotal,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type EnqueueMarketEvaluateAllSignalsResult =
  | {
      ok: true;
      /** True when handed off to Relay; false when the worker ran inline (no Relay env). */
      queued: boolean;
      /**
       * Number of Relay messages published. Only set when `queued === true`. ≥ 2 means a
       * sequential Relay message group; 1 means a single Relay message (covered by
       * `relayMessageId` for backwards compatibility).
       */
      chunkCount?: number;
      /** Set when ≥ 2 chunks were published. */
      relayMessageGroupId?: string | null;
      /** Set when exactly 1 chunk was published (backwards compatible). */
      relayMessageId?: string;
      /** Inline result fields (only when `queued === false`). */
      candleTotal?: number;
      barsProcessed?: number;
      signalsUpserted?: number;
      deadlineHit?: boolean;
      agentCount?: number;
      /** True when blocked by an already-running `market_evaluate_all_signals` row. */
      skipped?: boolean;
    }
  | { ok: false; error: string };

/**
 * Re-evaluate the Signal Agent over **every stored 15m candle** for one market, skipping
 * `(agent, candle)` tuples that already have signals for the automation user.
 *
 * When Relay is configured ({@link isRelayWorkerEnqueueConfigured}) the work is split
 * into UTC day chunks (default 30 days each) over the market's candle history and
 * published as a Relay message group via
 * {@link publishMarketEvaluateAllSignalsChunkedRelay} so each chunk gets its own
 * timeout / retry budget. With one chunk (small histories) the publisher falls back
 * to a single message. The historical executor `Run` path intentionally still uses
 * single Relay messages — see `apps/web/src/app/api/executors/[id]/historical-run/route.ts`.
 *
 * Without Relay configured the orchestrator runs inline once.
 */
export async function enqueueMarketEvaluateAllSignalsViaRelay(
  marketId: string,
  options?: { forceAgentSlugs?: readonly string[] },
): Promise<EnqueueMarketEvaluateAllSignalsResult> {
  const trimmedId = marketId.trim();
  if (!trimmedId) {
    return { ok: false, error: "Market id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: market, error: mErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id")
    .eq("id", trimmedId)
    .maybeSingle();
  if (mErr) {
    return { ok: false, error: mErr.message };
  }
  if (!market) {
    return { ok: false, error: "Market not found." };
  }

  const forceAgentSlugs = (options?.forceAgentSlugs ?? []).map((s) => s.trim()).filter(Boolean);

  try {
    if (await isRelayWorkerEnqueueConfigured()) {
      const relayBase = normalizeRelayBaseUrl();
      const appBase = getAppBaseUrl();
      const admin = createServiceRoleClient();
      const published = await publishMarketEvaluateAllSignalsChunkedRelay({
        admin,
        relayBase,
        appBase,
        marketId: trimmedId,
        ...(forceAgentSlugs.length > 0 ? { forceAgentSlugs } : {}),
      });
      if (!published.ok) {
        return { ok: false, error: published.error };
      }
      const chunkCount = published.messageIds.length;
      return {
        ok: true,
        queued: true,
        chunkCount,
        ...(chunkCount === 1
          ? { relayMessageId: published.messageIds[0] }
          : { relayMessageGroupId: published.groupId }),
      };
    }

    const outcome = await executeMarketEvaluateAllSignalsWithSyncRun(
      { marketId: trimmedId, ...(forceAgentSlugs.length > 0 ? { forceAgentSlugs } : {}) },
      "manual",
    );
    revalidatePath(`/markets/${trimmedId}`);
    revalidatePath("/signals");
    if (outcome.kind === "skipped_overlap") {
      return { ok: true, queued: false, skipped: true };
    }
    return {
      ok: true,
      queued: false,
      candleTotal: outcome.result.candleTotal,
      barsProcessed: outcome.result.barsProcessed,
      signalsUpserted: outcome.result.signalsUpserted,
      deadlineHit: outcome.result.deadlineHit,
      agentCount: outcome.result.agentCount,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type DeleteAllSignalsForMarketActionResult =
  | {
      ok: true;
      marketSymbol: string;
      candlesScanned: number;
      signalsDeleted: number;
    }
  | { ok: false; error: string };

/**
 * Wipe every `trading.signals` row whose `candle_id` belongs to this market. The DB
 * cascades the delete to `trading.decisions` → `trading.orders` → `trading.fills` for
 * any row that referenced the deleted signals; `trading.positions` are NOT cascaded
 * (they reference `executor_id` / `market_id`, not signal/order ids). The caller's
 * confirmation dialog is responsible for warning the user about the cascade.
 *
 * Intended for "let me start fresh on this market" workflows after the user decides
 * the existing signals are stale or wrong. For targeted "rebuild one agent in place"
 * use the existing "Re-evaluate regime" flow instead — it preserves signal ids.
 */
export async function deleteAllSignalsForMarketAction(
  marketId: string,
): Promise<DeleteAllSignalsForMarketActionResult> {
  const trimmedId = marketId.trim();
  if (!trimmedId) {
    return { ok: false, error: "Market id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: market, error: mErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id")
    .eq("id", trimmedId)
    .maybeSingle();
  if (mErr) {
    return { ok: false, error: mErr.message };
  }
  if (!market) {
    return { ok: false, error: "Market not found." };
  }

  try {
    const admin = createServiceRoleClient();
    const result = await deleteAllSignalsForMarket(admin, { marketId: trimmedId });
    revalidatePath(`/markets/${trimmedId}`);
    revalidatePath("/signals");
    revalidatePath("/trade-decisions");
    revalidatePath("/orders");
    revalidatePath("/fills");
    return {
      ok: true,
      marketSymbol: result.marketSymbol,
      candlesScanned: result.candlesScanned,
      signalsDeleted: result.signalsDeleted,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
