import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishRequest } from "@upstash/qstash";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { createQstashClient, getAppBaseUrl } from "@/lib/qstash/qstash-client";
import { escapeIlikeExactPattern } from "@/lib/markets/resolve-primary-market-by-codes";
import { getNumericSystemSetting } from "@/lib/system-settings/read-settings";
import { SYSTEM_SETTING_NUMERIC_KEYS } from "@/lib/system-settings/registry";

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
  published: number;
  failures: ExchangeClosePublishFailure[];
  error?: string;
  /** Effective stagger in seconds (`public.system_settings` → env → default) when this run started. */
  appliedStaggerSec: number;
  /** First few `Upstash-Delay` values sent to QStash (debug: compare with terminal spacing). */
  staggerDelaySamples?: string[];
  /** Parallel `publish` calls per wave (same resolution order as `appliedStaggerSec`). */
  qstashPublishConcurrency?: number;
};

/** QStash `Upstash-Delay` duration string; numeric `delay` in the SDK is rounded to whole seconds. */
function qstashDelayHeaderFromSeconds(totalSec: number): PublishRequest["delay"] {
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    return "0s";
  }
  const capped = Math.min(totalSec, 604_800); // 7d doc limit; keeps header sane
  const rounded = Math.round(capped * 10_000) / 10_000;
  if (rounded === Math.floor(rounded)) {
    return `${Math.floor(rounded)}s` as PublishRequest["delay"];
  }
  return `${rounded}s` as PublishRequest["delay"];
}

/** PostgREST `.in()` is encoded in the query string; large exchanges exceed HTTP URI limits in one call. */
const ASSET_ID_IN_CHUNK = 120;

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
  /** Read once per HTTP run from DB (then env, then defaults) so edits apply without restarting Node. */
  const [appliedStaggerSec, qstashPublishConcurrency] = await Promise.all([
    getNumericSystemSetting(admin, SYSTEM_SETTING_NUMERIC_KEYS.EXCHANGE_CLOSE_QSTASH_STAGGER_SEC),
    getNumericSystemSetting(admin, SYSTEM_SETTING_NUMERIC_KEYS.EXCHANGE_CLOSE_QSTASH_PUBLISH_CONCURRENCY),
  ]);

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
      appliedStaggerSec,
    };
  }

  const quote = (opts.quote ?? "EUR").trim().toUpperCase() || "EUR";
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
      appliedStaggerSec,
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
      appliedStaggerSec,
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
      appliedStaggerSec,
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
      assets (
        coingecko_market_cap_usd
      )
    `,
    )
    .eq("exchange_id", exchangeId)
    .eq("quote_code", quote);

  if (mErr) {
    return {
      ok: false,
      exchangeCode: canonicalExchangeCode,
      quote,
      distinctAssetCodes: [],
      published: 0,
      failures: [],
      error: mErr.message,
      appliedStaggerSec,
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
      appliedStaggerSec,
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
      appliedStaggerSec,
    };
  }

  const distinctAssetCodes = orderedAssetIds
    .map((id) => assetCodesResult.map.get(id))
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);

  let client;
  let base: string;
  try {
    client = createQstashClient();
    base = getAppBaseUrl();
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
      appliedStaggerSec,
    };
  }

  const stagger = appliedStaggerSec;
  const failures: ExchangeClosePublishFailure[] = [];
  let published = 0;

  const staggerDelaySamples = distinctAssetCodes.slice(0, 5).map((_, i) =>
    String(qstashDelayHeaderFromSeconds(i * stagger)),
  );

  if (process.env.NODE_ENV === "development") {
    console.info("[exchange-close-pipeline] QStash stagger", {
      appliedStaggerSec: stagger,
      delayHeadersFirst5: staggerDelaySamples,
      qstashPublishConcurrency,
    });
  }

  for (let i = 0; i < distinctAssetCodes.length; i += qstashPublishConcurrency) {
    const batch = distinctAssetCodes.slice(i, i + qstashPublishConcurrency);
    const settled = await Promise.allSettled(
      batch.map((assetCode, j) => {
        const idx = i + j;
        const u = new URL(`${base}/api/workers/asset-close-pipeline`);
        u.searchParams.set("assetCode", assetCode);
        u.searchParams.set("exchangeCode", canonicalExchangeCode);
        if (quote !== "EUR") {
          u.searchParams.set("quote", quote);
        }
        return client.publish({
          url: u.toString(),
          method: "GET",
          delay: qstashDelayHeaderFromSeconds(idx * stagger),
        });
      }),
    );
    for (let k = 0; k < settled.length; k++) {
      const r = settled[k]!;
      const assetCode = batch[k]!;
      if (r.status === "fulfilled") {
        published += 1;
      } else {
        const reason = r.reason;
        failures.push({
          assetCode,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    exchangeCode: canonicalExchangeCode,
    quote,
    distinctAssetCodes,
    published,
    failures,
    appliedStaggerSec: stagger,
    staggerDelaySamples,
    qstashPublishConcurrency,
    ...(failures.length ? { error: "one_or_more_publish_failed" } : {}),
  };
}
