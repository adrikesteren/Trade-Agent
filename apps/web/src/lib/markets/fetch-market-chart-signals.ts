import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bucketOpenTimeIso } from "@/lib/markets/aggregate-bucket-key";
import {
  CATALOG_STORAGE_TIMEFRAME,
  isChartVisibleIntent,
  isRegimeLabel,
  REGIME_CLASSIFIER_AGENT_SLUG,
  type ChartRegimeChange,
  type ChartSignal,
  type ChartTimeframe,
  type ChartVisibleIntent,
  type RegimeLabel,
} from "@/lib/markets/chart-types";
import {
  CATALOG_MARKET_CHART_CANDLE_MAX_ROWS,
  CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE,
} from "@/lib/markets/fetch-market-chart-candles";

const SIGNAL_IN_CHUNK = 100;

type CandleIdOpenTimeRow = {
  id: string;
  candle_timestamps: unknown;
};

type SignalChartRow = {
  id: string;
  signal_agent_id: string;
  intent: string;
  signal_side: string | null;
  confidence: number | string | null;
  candle_id: string;
  signal_agents: { agent_id?: string | null } | { agent_id?: string | null }[] | null;
};

function unwrap<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function agentSlugFromRow(row: SignalChartRow): string {
  const rel = unwrap(row.signal_agents);
  const slug = rel?.agent_id;
  return typeof slug === "string" && slug.trim() ? slug.trim() : `${row.signal_agent_id.slice(0, 8)}…`;
}

function parseConfidence(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseSide(v: string | null | undefined): "long" | "short" {
  return v === "short" ? "short" : "long";
}

/**
 * Pull all storage-timeframe candle ids + open_time for a market, paginated past
 * PostgREST `max_rows`. Returns a `Map<candleId, openTimeIso>` used to bucket each
 * signal to its aggregated chart bar.
 */
async function fetchCandleOpenTimesForMarket(
  supabase: SupabaseClient,
  marketId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let from = 0;

  while (out.size < CATALOG_MARKET_CHART_CANDLE_MAX_ROWS) {
    const room = CATALOG_MARKET_CHART_CANDLE_MAX_ROWS - out.size;
    const page = Math.min(CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE, room);
    const to = from + page - 1;

    const { data, error } = await supabase
      .schema("catalog")
      .from("candles")
      .select("id, candle_timestamps ( open_time )")
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
      .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const chunk = (data ?? []) as CandleIdOpenTimeRow[];
    if (!chunk.length) break;

    for (const row of chunk) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const ts = unwrap<{ open_time?: string | null }>(row.candle_timestamps as never);
      const open = ts?.open_time;
      if (typeof open === "string" && open.trim()) {
        out.set(id, open.trim());
      }
    }

    from += chunk.length;
    if (chunk.length < page) break;
  }

  return out;
}

function bucketSignalsFromMap(
  rows: SignalChartRow[],
  candleOpenTimeById: Map<string, string>,
  timeframe: ChartTimeframe,
): ChartSignal[] {
  const out: ChartSignal[] = [];
  for (const raw of rows) {
    const intent = raw.intent as ChartVisibleIntent;
    if (!isChartVisibleIntent(intent)) continue;
    const sourceOpen = candleOpenTimeById.get(String(raw.candle_id));
    if (!sourceOpen) continue;
    const bucket = bucketOpenTimeIso(sourceOpen, timeframe);
    if (!bucket) continue;
    out.push({
      id: raw.id,
      bucketOpenTimeIso: bucket,
      intent,
      agentSlug: agentSlugFromRow(raw),
      side: parseSide(raw.signal_side),
      confidence: parseConfidence(raw.confidence),
    });
  }
  return out;
}

async function fetchSignalsForCandleIds(
  supabase: SupabaseClient,
  candleIds: string[],
  candleOpenTimeById: Map<string, string>,
  timeframe: ChartTimeframe,
): Promise<ChartSignal[]> {
  const out: ChartSignal[] = [];
  for (let i = 0; i < candleIds.length; i += SIGNAL_IN_CHUNK) {
    const chunk = candleIds.slice(i, i + SIGNAL_IN_CHUNK);
    const { data, error } = await supabase
      .schema("trading")
      .from("signals")
      .select(
        "id, signal_agent_id, intent, signal_side, confidence, candle_id, signal_agents ( agent_id )",
      )
      .in("candle_id", chunk)
      .neq("intent", "HOLD");

    if (error) {
      console.error("fetchMarketChartSignals: chunk error:", error.message);
      continue;
    }

    out.push(...bucketSignalsFromMap((data ?? []) as SignalChartRow[], candleOpenTimeById, timeframe));
  }
  return out;
}

/**
 * Fetch signals (`intent != HOLD`) for a market, bucketed to `timeframe`.
 *
 * `trading.signals` has no `market_id` — we resolve the market by joining on
 * `candle_id` (which lives in `catalog.candles`). RLS on `trading.signals` filters
 * to the calling user automatically.
 */
export async function fetchMarketChartSignals(
  supabase: SupabaseClient,
  args: { marketId: string; timeframe: ChartTimeframe },
): Promise<ChartSignal[]> {
  const candleOpenTimeById = await fetchCandleOpenTimesForMarket(supabase, args.marketId);
  if (candleOpenTimeById.size === 0) return [];
  return fetchSignalsForCandleIds(
    supabase,
    [...candleOpenTimeById.keys()],
    candleOpenTimeById,
    args.timeframe,
  );
}

type RegimeSignalRow = {
  id: string;
  candle_id: string;
  metadata: unknown;
  reasons: unknown;
};

function regimeFromMetadata(meta: unknown): RegimeLabel | null {
  if (!meta || typeof meta !== "object") return null;
  const candidate = (meta as Record<string, unknown>).regime;
  return isRegimeLabel(candidate) ? candidate : null;
}

/**
 * `regime-classifier-15m-v1` writes `regime: "sideways"` as the *default* whenever it
 * can't make a real call (e.g. not enough daily bars yet for the SMA(200), or the target
 * close is missing from the aggregated series). Those rows surface in `reasons` with
 * non-`"regime=…"` codes such as `"insufficient_bars"`.
 *
 * Returns `true` when the row encodes an actual bull/bear/sideways classification, and
 * `false` for the no-opinion fallbacks we want to filter out of the chart bands so the
 * UI doesn't show a misleading "all sideways" shade for a market with too little history.
 */
function isRealRegimeClassification(reasons: unknown): boolean {
  if (!Array.isArray(reasons) || reasons.length === 0) return false;
  const head = reasons[0];
  return typeof head === "string" && head.startsWith("regime=");
}

/**
 * Coverage hint surfaced when the regime classifier was running but **didn't have enough
 * history** to make a real call. Built from the most recent insufficient-bars row.
 */
export type RegimeInsufficientHistoryHint = {
  haveBars: number;
  needBars: number;
  /** ISO `open_time` of the storage-timeframe bar where we last hit the insufficiency. */
  asOfOpenTimeIso: string;
  /**
   * Trend timeframe (in minutes) the SMA was computed on (e.g. `60` for 1h, `240` for 4h,
   * `1440` for daily). Null for legacy signals written before `metadata.trendTimeframeMinutes`
   * was added — the UI then falls back to a generic "bars" label.
   */
  trendTimeframeMinutes: number | null;
};

function readBars(meta: unknown, key: "haveBars" | "needBars"): number | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>)[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readTrendTimeframeMinutes(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>).trendTimeframeMinutes;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type FetchRegimeChangesResult = {
  regimeChanges: ChartRegimeChange[];
  /** Set when the classifier emitted at least one `insufficient_bars` row. */
  insufficient: RegimeInsufficientHistoryHint | null;
};

/**
 * Detect regime *changes* (switches) for a market: walks the chronological series of
 * `regime-classifier-15m-v1` HOLD signals and emits one entry **only when** the regime
 * label differs from the immediately previous classification. The very first entry in the
 * series is always emitted (it marks the initial regime detection).
 *
 * Result is bucketed to `timeframe` so markers land on the same aggregated bar as the
 * candles rendered on the chart.
 *
 * **`insufficient_bars` rows are filtered out of `regimeChanges`.** Those represent the
 * default fallback the classifier writes when it doesn't have enough daily bars yet for
 * the SMA(200) — surfacing them as a coloured band would make a market with too little
 * history look misleadingly "sideways for months". The most recent insufficient row is
 * still surfaced via the `insufficient` field so the UI can render a coverage hint.
 */
export async function fetchMarketChartRegimeChanges(
  supabase: SupabaseClient,
  args: { marketId: string; timeframe: ChartTimeframe },
): Promise<FetchRegimeChangesResult> {
  const candleOpenTimeById = await fetchCandleOpenTimesForMarket(supabase, args.marketId);
  if (candleOpenTimeById.size === 0) {
    return { regimeChanges: [], insufficient: null };
  }
  return fetchRegimeChangesForCandleMap(supabase, candleOpenTimeById, args.timeframe);
}

async function fetchRegimeChangesForCandleMap(
  supabase: SupabaseClient,
  candleOpenTimeById: Map<string, string>,
  timeframe: ChartTimeframe,
): Promise<FetchRegimeChangesResult> {
  const candleIds = [...candleOpenTimeById.keys()];
  const seenSignalIds = new Set<string>();
  const collected: { id: string; sourceOpenIso: string; regime: RegimeLabel }[] = [];
  let insufficient: RegimeInsufficientHistoryHint | null = null;

  for (let i = 0; i < candleIds.length; i += SIGNAL_IN_CHUNK) {
    const chunk = candleIds.slice(i, i + SIGNAL_IN_CHUNK);
    const { data, error } = await supabase
      .schema("trading")
      .from("signals")
      .select("id, candle_id, metadata, reasons, signal_agents!inner ( agent_id )")
      .eq("signal_agents.agent_id", REGIME_CLASSIFIER_AGENT_SLUG)
      .in("candle_id", chunk);

    if (error) {
      console.error("fetchMarketChartRegimeChanges: chunk error:", error.message);
      continue;
    }

    for (const raw of (data ?? []) as RegimeSignalRow[]) {
      const regime = regimeFromMetadata(raw.metadata);
      if (!regime) continue;
      const sourceOpen = candleOpenTimeById.get(String(raw.candle_id));
      if (!sourceOpen) continue;
      // RLS may surface multiple per-user rows for the same candle (own + automation).
      // Dedupe by signal id; the regime label itself is deterministic across users.
      if (seenSignalIds.has(raw.id)) continue;
      seenSignalIds.add(raw.id);

      if (!isRealRegimeClassification(raw.reasons)) {
        // Track the most recent (= largest sourceOpenIso) insufficient_bars row so the
        // UI can show "X / Y <tf> bars" instead of an empty regime row.
        const haveBars = readBars(raw.metadata, "haveBars");
        const needBars = readBars(raw.metadata, "needBars");
        if (haveBars != null && needBars != null) {
          if (insufficient == null || sourceOpen > insufficient.asOfOpenTimeIso) {
            insufficient = {
              haveBars,
              needBars,
              asOfOpenTimeIso: sourceOpen,
              trendTimeframeMinutes: readTrendTimeframeMinutes(raw.metadata),
            };
          }
        }
        continue;
      }

      collected.push({ id: raw.id, sourceOpenIso: sourceOpen, regime });
    }
  }

  if (collected.length === 0) return { regimeChanges: [], insufficient };

  // Multiple user-scoped regime classifier rows can exist on the same candle (own user +
  // automation). After id-dedupe we may still have one row per (candle × user); collapse
  // to one regime label per candle (they should agree since the agent is deterministic).
  const regimeByCandleOpen = new Map<string, RegimeLabel>();
  const idByCandleOpen = new Map<string, string>();
  for (const entry of collected) {
    if (!regimeByCandleOpen.has(entry.sourceOpenIso)) {
      regimeByCandleOpen.set(entry.sourceOpenIso, entry.regime);
      idByCandleOpen.set(entry.sourceOpenIso, entry.id);
    }
  }

  const sortedOpenTimes = [...regimeByCandleOpen.keys()].sort((a, b) => a.localeCompare(b));

  const out: ChartRegimeChange[] = [];
  let prev: RegimeLabel | null = null;
  for (const sourceOpen of sortedOpenTimes) {
    const regime = regimeByCandleOpen.get(sourceOpen)!;
    if (regime === prev) continue;
    const bucket = bucketOpenTimeIso(sourceOpen, timeframe);
    if (!bucket) {
      prev = regime;
      continue;
    }
    out.push({
      id: idByCandleOpen.get(sourceOpen)!,
      bucketOpenTimeIso: bucket,
      regime,
      prevRegime: prev,
    });
    prev = regime;
  }

  return { regimeChanges: out, insufficient };
}

/**
 * Coordinated fetch: returns chart signals + regime changes (+ insufficient-history hint)
 * in one round trip, sharing the underlying `(candleId → openTime)` map.
 */
export async function fetchMarketChartSignalsAndRegime(
  supabase: SupabaseClient,
  args: { marketId: string; timeframe: ChartTimeframe },
): Promise<{
  signals: ChartSignal[];
  regimeChanges: ChartRegimeChange[];
  regimeInsufficient: RegimeInsufficientHistoryHint | null;
}> {
  const candleOpenTimeById = await fetchCandleOpenTimesForMarket(supabase, args.marketId);
  if (candleOpenTimeById.size === 0) {
    return { signals: [], regimeChanges: [], regimeInsufficient: null };
  }

  const candleIds = [...candleOpenTimeById.keys()];
  const [signals, regime] = await Promise.all([
    fetchSignalsForCandleIds(supabase, candleIds, candleOpenTimeById, args.timeframe),
    fetchRegimeChangesForCandleMap(supabase, candleOpenTimeById, args.timeframe),
  ]);
  return {
    signals,
    regimeChanges: regime.regimeChanges,
    regimeInsufficient: regime.insufficient,
  };
}
