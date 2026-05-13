import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { escapeIlikeExactPattern } from "@/lib/markets/resolve-primary-market-by-codes";
import { resolveQuoteAssetId } from "@/lib/markets/resolve-quote-asset";
import {
  buildSymbolClosePipelineUrl,
  downstreamWorkerHeaders,
  normalizeRelayBaseUrl,
  postRelayMessageGroup,
  postRelaySingleMessage,
  relayMaxRetries,
} from "@/lib/relay/relay-symbol-close-pipeline-client";

export type RunExchangeClosePipelineOptions = {
  exchangeCode: string;
  /** Default EUR */
  quote?: string;
};

export type ExchangeClosePublishFailure = { assetCode: string; message: string };

export type RunExchangeClosePipelineResult = {
  ok: boolean;
  exchangeCode: string;
  quote: string;
  distinctAssetCodes: string[];
  /** Successfully enqueued worker jobs (same as distinct count when `ok`). */
  published: number;
  failures: ExchangeClosePublishFailure[];
  error?: string;
  /** Relay message UUIDs created (single-message and group members, in enqueue order). */
  relayMessageIds?: string[];
  /** Relay message_group UUID when a multi-job `message-group` was used (one group for all assets). */
  relayMessageGroupIds?: string[];
};

type MarketRowForMcap = {
  asset_id: string;
  market_symbol?: string | null;
  assets:
    | { coingecko_market_cap_usd?: number | string | null }
    | { coingecko_market_cap_usd?: number | string | null }[]
    | null;
};

function coingeckoMarketCapUsdDescKey(row: MarketRowForMcap): number {
  const raw = row.assets;
  const asset = Array.isArray(raw) ? raw[0] : raw;
  const v = asset?.coingecko_market_cap_usd;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (Number.isFinite(n)) return n;
  return Number.NEGATIVE_INFINITY;
}

/** PostgREST `.in()` is encoded in the query string; large exchanges exceed HTTP URI limits in one call. */
const ASSET_ID_IN_CHUNK = 120;

async function fetchAssetIdToCodeMap(
  admin: SupabaseClient,
  assetIds: string[],
): Promise<{ ok: true; map: Map<string, string> } | { ok: false; message: string }> {
  const map = new Map<string, string>();
  for (let i = 0; i < assetIds.length; i += ASSET_ID_IN_CHUNK) {
    const slice = assetIds.slice(i, i + ASSET_ID_IN_CHUNK);
    const { data: aRows, error: aErr } = await admin
      .schema("catalog")
      .from("assets")
      .select("id, code")
      .in("id", slice);
    if (aErr) {
      return { ok: false, message: aErr.message };
    }
    for (const r of aRows ?? []) {
      const id = String((r as { id: string }).id).trim();
      const c = String((r as { code: string }).code).trim();
      if (id && c) map.set(id, c);
    }
  }
  return { ok: true, map };
}

export async function runExchangeClosePipeline(
  admin: SupabaseClient,
  opts: RunExchangeClosePipelineOptions,
): Promise<RunExchangeClosePipelineResult> {
  loadMonorepoDotenvOnce();

  const exchangeIn = opts.exchangeCode.trim();
  if (!exchangeIn) {
    return {
      ok: false,
      exchangeCode: exchangeIn,
      quote: "EUR",
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: "exchangeCode is required",
    };
  }

  const quote = (opts.quote ?? "EUR").trim().toUpperCase() || "EUR";
  const quoteAssetId = await resolveQuoteAssetId(admin, quote);
  if (!quoteAssetId) {
    return {
      ok: false,
      exchangeCode: exchangeIn,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: "unknown_quote_asset",
    };
  }

  const exPattern = escapeIlikeExactPattern(exchangeIn);

  const { data: exRows, error: exErr } = await admin
    .schema("catalog")
    .from("exchanges")
    .select("id, code")
    .ilike("code", exPattern);

  if (exErr) {
    return {
      ok: false,
      exchangeCode: exchangeIn,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: exErr.message,
    };
  }

  const exchanges = (exRows ?? []) as { id: string; code: string }[];
  if (exchanges.length === 0) {
    return {
      ok: false,
      exchangeCode: exchangeIn,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: "unknown_exchange_code",
    };
  }
  if (exchanges.length > 1) {
    return {
      ok: false,
      exchangeCode: exchangeIn,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: "ambiguous_exchange_code",
    };
  }

  const ex = exchanges[0]!;
  const exchangeId = ex.id as string;
  const canonicalExchangeCode = String(ex.code);

  const { data: mRows, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select(
      `
      asset_id,
      market_symbol,
      assets!markets_asset_id_fkey (
        coingecko_market_cap_usd
      )
    `,
    )
    .eq("exchange_id", exchangeId)
    .eq("quote_asset_id", quoteAssetId);

  if (mErr) {
    return {
      ok: false,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: mErr.message,
    };
  }

  const marketRows = (mRows ?? []) as MarketRowForMcap[];
  const sorted = [...marketRows].sort((a, b) => {
    const d = coingeckoMarketCapUsdDescKey(b) - coingeckoMarketCapUsdDescKey(a);
    if (d !== 0) return d;
    return String(a.market_symbol ?? "").localeCompare(String(b.market_symbol ?? ""), undefined, {
      sensitivity: "base",
    });
  });

  const orderedAssetIds: string[] = [];
  const seenAssetId = new Set<string>();
  for (const r of sorted) {
    const id = String(r.asset_id ?? "").trim();
    if (!id || seenAssetId.has(id)) continue;
    seenAssetId.add(id);
    orderedAssetIds.push(id);
  }

  if (orderedAssetIds.length === 0) {
    return {
      ok: true,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
    };
  }

  const assetCodesResult = await fetchAssetIdToCodeMap(admin, orderedAssetIds);
  if (!assetCodesResult.ok) {
    return {
      ok: false,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: assetCodesResult.message,
    };
  }

  const distinctAssetCodes = orderedAssetIds
    .map((id) => assetCodesResult.map.get(id))
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);

  if (distinctAssetCodes.length === 0) {
    return {
      ok: true,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
    };
  }

  let relayBase: string;
  let appBase: string;
  let workerHeaders: Record<string, string>;
  let maxRetries: number;
  try {
    relayBase = normalizeRelayBaseUrl();
    appBase = getAppBaseUrl();
    workerHeaders = await downstreamWorkerHeaders();
    maxRetries = relayMaxRetries();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes,
      published: 0,
      failures: [],
      error: msg,
    };
  }

  const relayMessageIds: string[] = [];
  const relayMessageGroupIds: string[] = [];
  const failures: ExchangeClosePublishFailure[] = [];

  const urls = distinctAssetCodes.map((assetCode) =>
    buildSymbolClosePipelineUrl(appBase, assetCode, canonicalExchangeCode, quote),
  );

  try {
    if (urls.length === 1) {
      const id = await postRelaySingleMessage(relayBase, urls[0]!, workerHeaders, maxRetries);
      relayMessageIds.push(id);
    } else {
      const { groupId, messageIds } = await postRelayMessageGroup(relayBase, urls, workerHeaders, maxRetries);
      relayMessageGroupIds.push(groupId);
      relayMessageIds.push(...messageIds);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes,
      published: 0,
      failures: [{ assetCode: "_relay", message: msg }],
      error: msg,
      relayMessageIds: relayMessageIds.length ? relayMessageIds : undefined,
      relayMessageGroupIds: relayMessageGroupIds.length ? relayMessageGroupIds : undefined,
    };
  }

  const published = distinctAssetCodes.length;

  if (process.env.NODE_ENV === "development") {
    console.info("[exchange-close-pipeline] Relay enqueue", {
      published,
      relayMessageGroupIds,
      relayMessageCount: relayMessageIds.length,
    });
  }

  return {
    ok: true,
    exchangeCode: canonicalExchangeCode,
    quote,
    distinctAssetCodes,
    published,
    failures,
    relayMessageIds,
    relayMessageGroupIds: relayMessageGroupIds.length ? relayMessageGroupIds : undefined,
  };
}
