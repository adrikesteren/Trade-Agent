"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { runMarketBackfillCandles, todayUtcYmd } from "@/lib/orchestrators/market-backfill-candles.service";
import {
  buildMarketBackfillCandlesWorkerUrl,
  buildSymbolClosePipelineUrl,
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  normalizeRelayBaseUrl,
  postRelaySingleMessage,
  RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S,
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
 * When Relay is configured ({@link isRelayWorkerEnqueueConfigured}) the work is enqueued on Relay
 * with a 30-minute message timeout ({@link RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S}); otherwise it
 * runs inline using the service-role client and revalidates the market page.
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
      const url = buildMarketBackfillCandlesWorkerUrl(appBase, { marketId, startDate, endDate });
      const relayMessageId = await postRelaySingleMessage(
        relayBase,
        url,
        await downstreamWorkerHeaders(),
        relayMaxRetries(),
        { timeoutSec: RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S },
      );
      return { ok: true, queued: true, relayMessageId };
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
