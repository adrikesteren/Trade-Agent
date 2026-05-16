import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEnabledSignalAgents } from "@/lib/agents/signal/services/enabled-signal-agents-fetch.service";
import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { evaluateRegimeAtClose } from "@/lib/agents/signal/services/regime-classifier-eval.service";
import { aggregateReplayBarsToTimeframe } from "@/lib/markets/aggregate-replay-bars";
import { CATALOG_STORAGE_TIMEFRAME, REGIME_CLASSIFIER_AGENT_SLUG } from "@/lib/markets/chart-types";
import {
  CATALOG_MARKET_CHART_CANDLE_MAX_ROWS,
  CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE,
} from "@/lib/markets/fetch-market-chart-candles";

/**
 * Bulk-upsert chunk size. Each chunk = one HTTP roundtrip, so larger is faster but raises
 * the chance of hitting PostgREST max-payload caps. 500 is a comfortable middle ground.
 */
const REGIME_REBUILD_BULK_CHUNK = 500;

export type RebuildRegimeClassifierForMarketResult = {
  ok: true;
  marketId: string;
  marketSymbol: string;
  candlesConsidered: number;
  signalsUpserted: number;
  /**
   * Number of bars where the classifier emitted a real bull/bear classification (vs
   * `sideways` / fallback). Useful as a smoke check — if 0 the trend timeframe needs
   * more warmup than the market actually has stored.
   */
  realClassifications: number;
  /** Per-agent config snapshot the rebuild used (for the audit trail). */
  configSnapshot: { maPeriod: number; slopeLookback: number; trendTimeframeMinutes: number };
};

type StoredBar = {
  id: string;
  closeTimeIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type RawCandleRow = {
  id: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  candle_timestamps: unknown;
};

function unwrapTs(raw: unknown): { close_time?: string | null } | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return (raw[0] as { close_time?: string | null }) ?? null;
  return raw as { close_time?: string | null };
}

async function fetchAllStoredBarsAsc(admin: SupabaseClient, marketId: string): Promise<StoredBar[]> {
  const out: StoredBar[] = [];
  let from = 0;
  while (out.length < CATALOG_MARKET_CHART_CANDLE_MAX_ROWS) {
    const room = CATALOG_MARKET_CHART_CANDLE_MAX_ROWS - out.length;
    const page = Math.min(CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE, room);
    const to = from + page - 1;
    const { data, error } = await admin
      .schema("catalog")
      .from("candles")
      .select("id, open, high, low, close, volume, candle_timestamps ( close_time )")
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
      .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
      .range(from, to);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as RawCandleRow[];
    if (!chunk.length) break;
    for (const row of chunk) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const ts = unwrapTs(row.candle_timestamps);
      const closeTimeIso = ts?.close_time?.trim();
      if (!closeTimeIso) continue;
      out.push({
        id,
        closeTimeIso,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      });
    }
    from += chunk.length;
    if (chunk.length < page) break;
  }
  return out;
}

/**
 * Focused, fast rebuild of `regime-classifier-15m-v1` signals for a single market.
 *
 * Why this exists alongside `runMarketEvaluateAllSignals`:
 *
 * The generic evaluate-all path re-aggregates the entire `barsThrough` slice and issues
 * one HTTP upsert **per bar** (and per other agent). For 17 000+ candles that means
 * ~17 000 roundtrips and O(N²) aggregation — measured at ~2 s/bar = many hours per
 * market. After a regime classifier seed config change we just need that one agent
 * regenerated, so we take a focused path:
 *
 *   1. One DB fetch of all stored candles (paginated).
 *   2. One in-memory 15m → trend-timeframe aggregation.
 *   3. Per bar: `evaluateRegimeAtClose` against the up-to-here trend slice (cheap;
 *      SMA(maPeriod) + slope is O(maPeriod)).
 *   4. **Bulk upsert** in chunks of {@link REGIME_REBUILD_BULK_CHUNK} — typically
 *      ~34 HTTP roundtrips for 17 000 rows instead of 17 000.
 *
 * The upsert key (`user_id, signal_agent_id, candle_id`) is identical to the per-bar
 * path so existing rows are overwritten in place — the signal id is preserved, so any
 * downstream FK reference (`trading.decisions.signal_id`, etc.) survives.
 */
export async function rebuildRegimeClassifierForMarket(
  admin: SupabaseClient,
  args: { marketId: string },
): Promise<RebuildRegimeClassifierForMarketResult> {
  const marketId = String(args.marketId ?? "").trim();
  if (!marketId) throw new Error("marketId is required");

  const { data: mrow, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("id", marketId)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("Market not found.");
  const marketSymbol = String((mrow as { market_symbol?: string | null }).market_symbol ?? "");

  const enabledAgents = await fetchEnabledSignalAgents(admin, { timeframe: CATALOG_STORAGE_TIMEFRAME });
  const agent = enabledAgents.find((a) => a.slug === REGIME_CLASSIFIER_AGENT_SLUG);
  if (!agent) {
    throw new Error(
      `Regime classifier (${REGIME_CLASSIFIER_AGENT_SLUG}) is not enabled — enable it before rebuilding.`,
    );
  }
  const cfg = (agent.config ?? {}) as Record<string, unknown>;
  const maPeriod = Math.max(2, Math.floor(Number(cfg.maPeriod ?? 100)));
  const slopeLookback = Math.max(1, Math.floor(Number(cfg.slopeLookback ?? 12)));
  const trendTimeframeMinutes = Math.max(15, Math.floor(Number(cfg.trendTimeframeMinutes ?? 60)));
  const slopePctEps = (() => {
    const v = Number(cfg.slopePctEps);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  })();
  const distancePctEps = (() => {
    const v = Number(cfg.distancePctEps);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  })();

  const signalUserIds = await getCatalogPipelineUserIds(admin);
  if (signalUserIds.length === 0) {
    throw new Error(
      "Rebuild requires the automated_process user (automation_actor or user_profiles.username = automated_process).",
    );
  }

  const sortedAll = await fetchAllStoredBarsAsc(admin, marketId);
  if (sortedAll.length === 0) {
    return {
      ok: true,
      marketId,
      marketSymbol,
      candlesConsidered: 0,
      signalsUpserted: 0,
      realClassifications: 0,
      configSnapshot: { maPeriod, slopeLookback, trendTimeframeMinutes },
    };
  }

  // Single in-memory aggregation pass (15m → trend timeframe).
  const trendBars = aggregateReplayBarsToTimeframe(
    sortedAll.map((b) => ({
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      closeTimeIso: b.closeTimeIso,
    })),
    trendTimeframeMinutes,
  );

  // Build all signal rows in memory. evaluateRegimeAtClose is pure and cheap; for each
  // 15m bar we look at the trend-timeframe slice that ends at that bar's close, so the
  // result is equivalent to per-bar replay.
  type Row = {
    user_id: string;
    signal_agent_id: string;
    candle_id: string;
    intent: string;
    signal_side: "long" | "short";
    confidence: number | null;
    reasons: string[];
    metadata: Record<string, unknown>;
  };
  const rows: Row[] = [];
  let realClassifications = 0;

  for (const bar of sortedAll) {
    const ev = evaluateRegimeAtClose({
      barsAsc: trendBars,
      targetCloseTimeIso: bar.closeTimeIso,
      maPeriod,
      slopeBars: slopeLookback,
      trendTimeframeMinutes,
      ...(slopePctEps != null ? { slopePctEps } : {}),
      ...(distancePctEps != null ? { distancePctEps } : {}),
    });
    const meta = ev.metadata as Record<string, unknown>;
    const regimeLabel = String(meta.regime ?? "");
    if (regimeLabel === "bull" || regimeLabel === "bear") realClassifications += 1;

    for (const userId of signalUserIds) {
      rows.push({
        user_id: userId,
        signal_agent_id: agent.id,
        candle_id: bar.id,
        intent: ev.intent,
        signal_side: ev.signalSide ?? "long",
        confidence: ev.confidence,
        reasons: ev.reasons,
        metadata: {
          ...meta,
          market_symbol: marketSymbol,
          agent_id: REGIME_CLASSIFIER_AGENT_SLUG,
          rebuiltAt: new Date().toISOString(),
        },
      });
    }
  }

  // Bulk upsert in chunks. The (user_id, signal_agent_id, candle_id) constraint already
  // exists — overwrites in place so signal id (and downstream FKs) survive.
  let signalsUpserted = 0;
  for (let i = 0; i < rows.length; i += REGIME_REBUILD_BULK_CHUNK) {
    const chunk = rows.slice(i, i + REGIME_REBUILD_BULK_CHUNK);
    const { error: upErr } = await admin
      .schema("trading")
      .from("signals")
      .upsert(chunk, { onConflict: "user_id,signal_agent_id,candle_id" });
    if (upErr) {
      throw new Error(`${marketSymbol}: regime rebuild bulk upsert (chunk ${i}): ${upErr.message}`);
    }
    signalsUpserted += chunk.length;
  }

  return {
    ok: true,
    marketId,
    marketSymbol,
    candlesConsidered: sortedAll.length,
    signalsUpserted,
    realClassifications,
    configSnapshot: { maPeriod, slopeLookback, trendTimeframeMinutes },
  };
}

export type RebuildRegimeClassifierAcrossMarketsResult = {
  ok: true;
  marketsConsidered: number;
  marketsProcessed: number;
  marketsFailed: number;
  candlesConsidered: number;
  signalsUpserted: number;
  realClassifications: number;
  configSnapshot: { maPeriod: number; slopeLookback: number; trendTimeframeMinutes: number } | null;
  perMarket: Pick<
    RebuildRegimeClassifierForMarketResult,
    "marketId" | "marketSymbol" | "candlesConsidered" | "signalsUpserted" | "realClassifications"
  >[];
  failures: { marketId: string; marketSymbol: string | null; error: string }[];
};

const FAILURE_CAP = 25;

/**
 * Loop {@link rebuildRegimeClassifierForMarket} across every market with at least one stored
 * candle. Sequential to keep memory + DB pressure predictable; per-market cost is bounded
 * by `O(candles + maPeriod)` so a couple of dozen 15k-candle markets still completes in
 * tens of seconds.
 */
export async function rebuildRegimeClassifierAcrossMarkets(
  admin: SupabaseClient,
): Promise<RebuildRegimeClassifierAcrossMarketsResult> {
  // Reuse the same "markets with at least one candle" listing pattern.
  const { data: marketRows, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .order("market_symbol", { ascending: true });
  if (mErr) throw new Error(mErr.message);
  const allMarkets = (marketRows ?? []) as { id: string; market_symbol: string }[];

  const present = new Set<string>();
  const chunk = 80;
  for (let i = 0; i < allMarkets.length; i += chunk) {
    const part = allMarkets.slice(i, i + chunk).map((m) => m.id);
    const { data, error } = await admin
      .schema("catalog")
      .from("candles")
      .select("market_id")
      .in("market_id", part)
      .limit(part.length);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { market_id: string }[]) {
      if (r.market_id) present.add(r.market_id);
    }
  }
  const targets = allMarkets.filter((m) => present.has(m.id));

  let marketsProcessed = 0;
  let marketsFailed = 0;
  let candlesConsidered = 0;
  let signalsUpserted = 0;
  let realClassifications = 0;
  let configSnapshot: RebuildRegimeClassifierAcrossMarketsResult["configSnapshot"] = null;
  const perMarket: RebuildRegimeClassifierAcrossMarketsResult["perMarket"] = [];
  const failures: RebuildRegimeClassifierAcrossMarketsResult["failures"] = [];

  for (const m of targets) {
    try {
      const r = await rebuildRegimeClassifierForMarket(admin, { marketId: m.id });
      marketsProcessed += 1;
      candlesConsidered += r.candlesConsidered;
      signalsUpserted += r.signalsUpserted;
      realClassifications += r.realClassifications;
      configSnapshot = r.configSnapshot;
      perMarket.push({
        marketId: r.marketId,
        marketSymbol: r.marketSymbol,
        candlesConsidered: r.candlesConsidered,
        signalsUpserted: r.signalsUpserted,
        realClassifications: r.realClassifications,
      });
    } catch (e) {
      marketsFailed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (failures.length < FAILURE_CAP) {
        failures.push({ marketId: m.id, marketSymbol: m.market_symbol ?? null, error: msg });
      }
    }
  }

  return {
    ok: true,
    marketsConsidered: targets.length,
    marketsProcessed,
    marketsFailed,
    candlesConsidered,
    signalsUpserted,
    realClassifications,
    configSnapshot,
    perMarket,
    failures,
  };
}
