"use server";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import {
  buildSymbolClosePipelineUrl,
  downstreamWorkerHeaders,
  normalizeRelayBaseUrl,
  postRelaySingleMessage,
  relayMaxRetries,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
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
      quote_code,
      assets ( code ),
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

  const quote = String(market.quote_code ?? "EUR").trim().toUpperCase() || "EUR";

  try {
    const relayBase = normalizeRelayBaseUrl();
    const appBase = getAppBaseUrl();
    const url = buildSymbolClosePipelineUrl(appBase, assetCode, exchangeCode, quote);
    const relayMessageId = await postRelaySingleMessage(
      relayBase,
      url,
      downstreamWorkerHeaders(),
      relayMaxRetries(),
    );
    return { ok: true, relayMessageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
