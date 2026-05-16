import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllCandleTimestampIdsInCloseTimeRange } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";
import * as CandlesSelector from "@/lib/selectors/candles-selector";

import { computeHistoricalCandleWindow } from "./historical-candle-window.service";

/**
 * Default number of closed bars before the replay window so MA/ATR/RSI have
 * enough indicator history. This is the **floor** for any caller that does
 * not pass an explicit `agents` hint — kept at the legacy value so
 * pre-P3 callers behave identically.
 *
 * Use {@link computeWarmupBars} to derive the right value per run. The P3
 * agents (regime-classifier, multi-tf-confluence) read indicators on a
 * higher trend timeframe and therefore need more 15m warmup; the helper
 * derives the exact requirement from each agent's `config` JSON so the
 * warmup automatically tracks the seed.
 */
export const HISTORICAL_REPLAY_WARMUP_BARS = 120;

/**
 * Subset of `EnabledSignalAgent` the warmup helper needs. We keep the type
 * inline so this module doesn't have to import from the signal namespace
 * (which would create a circular-ish dependency: ingest → signal → ingest).
 */
export type WarmupAgentInput = {
  slug: string;
  /** Raw `signal_agents.config` JSON. Empty object is fine (defaults are applied per-slug). */
  config: Record<string, unknown>;
};

/** Storage timeframe. Aggregation factors below are computed against this. */
const STORAGE_TF_MINUTES = 15;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 15m-bar warmup needed to make a single agent useful from bar 1, derived from
 * its `config` JSON. Mirrors the dispatcher defaults so a missing config still
 * matches the seeded behaviour. Unknown slugs return the legacy floor.
 */
function warmupBarsForAgent(input: WarmupAgentInput): number {
  switch (input.slug) {
    case "ma-cross-15m-v1":
    case "rsi-reversion-15m-v1":
    case "breakout-atr-15m-v1":
      return HISTORICAL_REPLAY_WARMUP_BARS;
    case "multi-tf-confluence-15m-v1": {
      // 4h SMA(trendMa) → trendMa × (240 / 15) bars on 15m. Plus a small entry-leg
      // RSI buffer (period × 4) — RSI(14) ≈ 56 bars, way under the trend leg.
      const trendMa = num(input.config.trendMa) ?? 50;
      const entryRsiPeriod = num(input.config.entryRsiPeriod) ?? 14;
      const trendBars = trendMa * (240 / STORAGE_TF_MINUTES);
      const entryBars = entryRsiPeriod * 4;
      return Math.max(HISTORICAL_REPLAY_WARMUP_BARS, Math.ceil(trendBars + entryBars));
    }
    case "regime-classifier-15m-v1": {
      // SMA(maPeriod) on the configured trend timeframe. With seed 4h × 200 →
      // 200 × (240 / 15) = 3200 × 15m bars (~33 days) instead of the legacy
      // 19_200 (~200 days for daily × 200).
      const maPeriod = num(input.config.maPeriod) ?? 200;
      const slopeBars = num(input.config.slopeLookback) ?? 20;
      const trendTfMin = num(input.config.trendTimeframeMinutes) ?? 240;
      const factor = Math.max(1, Math.floor(trendTfMin / STORAGE_TF_MINUTES));
      const needed = (Math.max(maPeriod, slopeBars + 1) + 1) * factor;
      return Math.max(HISTORICAL_REPLAY_WARMUP_BARS, needed);
    }
    default:
      return HISTORICAL_REPLAY_WARMUP_BARS;
  }
}

/**
 * Pick the warmup window size (in **15m bars**) needed to make every active
 * agent useful at bar 1 of the replay window. Falls back to the legacy
 * {@link HISTORICAL_REPLAY_WARMUP_BARS} floor when `agents` is empty or
 * contains only agents whose warmup is below that floor.
 *
 * `timeframe` is accepted for forward-compatibility (other timeframes than
 * 15m) but only 15m is supported today — pass it so callers don't have to
 * change once that lands.
 */
export function computeWarmupBars(
  timeframe: string,
  agents: readonly WarmupAgentInput[],
): number {
  if (timeframe !== "15m") {
    return HISTORICAL_REPLAY_WARMUP_BARS;
  }
  let max = HISTORICAL_REPLAY_WARMUP_BARS;
  for (const a of agents) {
    const n = warmupBarsForAgent(a);
    if (n > max) max = n;
  }
  return max;
}

/** PostgREST `.in()` batch size for `candle_timestamp_id` (URI length). */
const CANDLE_TS_IN_CHUNK = 80;

export type ReplayCandleBar = {
  id: string;
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
  /**
   * True when this bar was forward-filled in memory because Bitvavo omitted
   * the slot (no trades on an illiquid market). Downstream consumers can
   * choose to treat synthetic bars as "no liquidity event" — e.g. the
   * breakout-ATR volume filter won't trigger on volume = 0.
   */
  synthetic?: boolean;
};

type CandleRowDb = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps:
    | { close_time: string; open_time: string }
    | { close_time: string; open_time: string }[]
    | null;
};

function mapCandleRows(rows: CandleRowDb[]): ReplayCandleBar[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return {
        id: r.id,
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        closeTimeIso: closeTime,
        synthetic: false,
      } satisfies ReplayCandleBar;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function loadCandlesThroughRange(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<ReplayCandleBar[]> {
  const tsIds = await fetchAllCandleTimestampIdsInCloseTimeRange(admin, {
    closeTimeGteIso: args.closeTimeGteIso,
    closeTimeLteIso: args.closeTimeLteIso,
  });
  const out: CandleRowDb[] = [];
  for (let i = 0; i < tsIds.length; i += CANDLE_TS_IN_CHUNK) {
    const part = tsIds.slice(i, i + CANDLE_TS_IN_CHUNK);
    const cRows = await CandlesSelector.selectOhlcvWithOpenCloseByCandleTimestampIds(admin, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      candleTimestampIds: part,
    });
    out.push(...(cRows as CandleRowDb[]));
  }
  return mapCandleRows(out);
}

/** Count `catalog.candles` rows for a market/timeframe whose bucket `close_time` lies in the range. */
export async function countCandlesForMarketByCloseTimeRange(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<number> {
  const tsIds = await fetchAllCandleTimestampIdsInCloseTimeRange(admin, {
    closeTimeGteIso: args.closeTimeGteIso,
    closeTimeLteIso: args.closeTimeLteIso,
  });
  let total = 0;
  for (let i = 0; i < tsIds.length; i += CANDLE_TS_IN_CHUNK) {
    const part = tsIds.slice(i, i + CANDLE_TS_IN_CHUNK);
    total += await CandlesSelector.countByMarketTimeframeAndCandleTimestampIds(admin, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      candleTimestampIds: part,
    });
  }
  return total;
}

/**
 * Forward-fill missing bars on a 15m (or other-timeframe) grid in memory.
 *
 * Bitvavo legitimately omits buckets where no trades occurred. For illiquid
 * markets (e.g. GIGA-EUR) that can be the majority of bars in a year — we
 * still want a regular grid so RSI/MA/regime indicators see continuous time
 * steps. Strategy: copy the previous bar's close into a synthetic OHLC bar
 * (open=high=low=close = prev.close), keep volume implicit at 0 (no
 * field on `ReplayCandleBar`), and tag `synthetic: true` so downstream
 * filters can opt out.
 *
 * Leading gap (no prior real bar yet) is skipped — there is no sensible
 * close to forward-fill from. The first real bar establishes the seed.
 */
function forwardFillBarsOnGrid(
  realBars: readonly ReplayCandleBar[],
  gridStartCloseMs: number,
  gridEndCloseMs: number,
  stepMs: number,
): { bars: ReplayCandleBar[]; syntheticCount: number } {
  const byCloseMs = new Map<number, ReplayCandleBar>();
  for (const b of realBars) {
    const ms = Date.parse(b.closeTimeIso);
    if (Number.isFinite(ms)) byCloseMs.set(ms, b);
  }
  const out: ReplayCandleBar[] = [];
  let syntheticCount = 0;
  let prev: ReplayCandleBar | null = null;
  for (let closeMs = gridStartCloseMs; closeMs <= gridEndCloseMs; closeMs += stepMs) {
    const real = byCloseMs.get(closeMs);
    if (real) {
      out.push(real);
      prev = real;
      continue;
    }
    if (!prev) continue; // leading gap, no seed yet
    const closeTimeIso = new Date(closeMs).toISOString();
    out.push({
      id: `synthetic:${closeTimeIso}`,
      high: prev.close,
      low: prev.close,
      close: prev.close,
      closeTimeIso,
      synthetic: true,
    });
    syntheticCount += 1;
  }
  return { bars: out, syntheticCount };
}

export type LoadHistoricalCandlesCoverage = {
  /** Slots in the replay window (from `barCount`). Warmup is not counted here. */
  expectedBars: number;
  /** Real `catalog.candles` rows found in the replay window. */
  realBars: number;
  /** `expectedBars - realBars`. */
  missingBars: number;
  /** Forward-filled bars added by {@link forwardFillBarsOnGrid} inside the replay window. */
  syntheticBars: number;
  /** `realBars / expectedBars` clamped to `[0, 1]`. */
  coveragePct: number;
};

export type LoadHistoricalCandlesForReplayResult = {
  /** Resolved window from `computeHistoricalCandleWindow` (kind: "ok"). */
  win: { startOpenMs: number; endCloseMs: number; barCount: number };
  /**
   * All bars from `warmupCloseFloor` through `endClose`, ascending. Dense:
   * gaps are forward-filled with synthetic bars so indicators have a
   * continuous time series. Real bars carry `synthetic: false`.
   */
  sortedAll: ReplayCandleBar[];
  /** Subset of `sortedAll` whose close falls inside the inclusive replay window. Also dense. */
  replayCloses: ReplayCandleBar[];
  /** First close time in the replay window (the bar that closes at `startOpenMs + step`). */
  firstReplayCloseIso: string;
  /** Last close time in the replay window (`endCloseMs`). */
  lastReplayCloseIso: string;
  /** Coverage stats so callers can surface "X% real, Y% synthetic" to the UI. */
  coverage: LoadHistoricalCandlesCoverage;
  /** Soft warnings worth showing in the run row metadata (formerly hard throws). */
  warnings: string[];
};

/**
 * Loads warmup + replay-window candles for a single market/timeframe and returns ascending bars on a
 * dense 15m grid (forward-filled where Bitvavo omitted no-trade slots).
 *
 * Throws only when the replay window has zero real bars after ingest — replay on a fully empty
 * window is meaningless. Partial sparsity is recorded as a soft warning in `coverage` /
 * `warnings`; the orchestrator writes both into `trading.executor_historical_runs.metadata`.
 */
export async function loadHistoricalCandlesForReplay(
  admin: SupabaseClient,
  args: {
    marketId: string;
    timeframe: string;
    historicalStartDate: string;
    historicalEndDate: string;
    /** Defaults to {@link HISTORICAL_REPLAY_WARMUP_BARS}. */
    warmupBars?: number;
  },
): Promise<LoadHistoricalCandlesForReplayResult> {
  const warmupBars = args.warmupBars ?? HISTORICAL_REPLAY_WARMUP_BARS;
  const stepMs = timeframeDurationMs(args.timeframe);

  const win = computeHistoricalCandleWindow({
    startDate: args.historicalStartDate,
    endDate: args.historicalEndDate,
    timeframe: args.timeframe,
  });
  if (win.kind !== "ok") {
    throw new Error(`Invalid historical window: ${win.reason}`);
  }

  const firstReplayCloseMs = win.startOpenMs + stepMs;
  const warmupCloseFloorMs = firstReplayCloseMs - warmupBars * stepMs;
  const warmupCloseFloorIso = new Date(warmupCloseFloorMs).toISOString();
  const firstReplayCloseIso = new Date(firstReplayCloseMs).toISOString();
  const lastReplayCloseIso = new Date(win.endCloseMs).toISOString();

  // Real bars in the replay window — used both for coverage stats and as the
  // throw-on-empty guard. We still load `sortedAll` separately below so warmup
  // bars get included (indicators need >= warmupBars of history before the
  // first replay bar).
  const candleCountInReplayWindow = await countCandlesForMarketByCloseTimeRange(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    closeTimeGteIso: firstReplayCloseIso,
    closeTimeLteIso: lastReplayCloseIso,
  });

  if (candleCountInReplayWindow === 0) {
    throw new Error(
      `No catalog.candles rows exist in the replay window ${firstReplayCloseIso} → ${lastReplayCloseIso}. ` +
        `Bitvavo returned no data for this market in the requested range — verify the asset/exchange and that ` +
        `the date range overlaps Bitvavo's history for this pair.`,
    );
  }

  const realSortedAll = await loadCandlesThroughRange(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    closeTimeGteIso: warmupCloseFloorIso,
    closeTimeLteIso: lastReplayCloseIso,
  });

  // Forward-fill the full warmup+replay grid in memory. `sortedAll` is dense
  // after this so indicators see continuous 15m steps. `replayCloses` is the
  // subset of REAL bars in the replay window — we don't iterate signals over
  // synthetic bars because `trading.signals.candle_id` FKs `catalog.candles`,
  // which has no row for forward-filled slots. Indicators still get continuity
  // because they read from `sortedAll`.
  const filled = forwardFillBarsOnGrid(realSortedAll, warmupCloseFloorMs, win.endCloseMs, stepMs);
  const sortedAll = filled.bars;

  const replayCloses = sortedAll.filter(
    (b) =>
      !b.synthetic &&
      Date.parse(b.closeTimeIso) >= firstReplayCloseMs &&
      Date.parse(b.closeTimeIso) <= win.endCloseMs,
  );
  if (replayCloses.length === 0) {
    throw new Error("No real candles in database for the historical range after ingest.");
  }

  // Count synthetic bars that ended up in the replay window for coverage stats
  // (they're not in `replayCloses` but they did get forward-filled in `sortedAll`).
  const syntheticBarsInReplay = sortedAll.filter(
    (b) =>
      b.synthetic &&
      Date.parse(b.closeTimeIso) >= firstReplayCloseMs &&
      Date.parse(b.closeTimeIso) <= win.endCloseMs,
  ).length;
  const missingBars = Math.max(0, win.barCount - candleCountInReplayWindow);
  const coveragePct = win.barCount > 0 ? Math.min(1, candleCountInReplayWindow / win.barCount) : 1;

  const warnings: string[] = [];
  // Surface a soft warning when sparsity is non-trivial — same thresholds as
  // the old hard throw, but now non-fatal. The orchestrator pins this on the
  // run row so the user sees it on the executor detail page.
  const shortfallThreshold = Math.max(50, Math.ceil(win.barCount * 0.02));
  if (missingBars >= shortfallThreshold) {
    warnings.push(
      `Catalog ingest is sparse: expected ${win.barCount} bars between ${args.historicalStartDate} and ` +
        `${args.historicalEndDate}, found ${candleCountInReplayWindow} real bars (${(coveragePct * 100).toFixed(1)}%). ` +
        `${syntheticBarsInReplay} synthetic bars were forward-filled in memory for indicator continuity. ` +
        `Bitvavo omits intervals with no trades — this is normal for illiquid markets.`,
    );
  }

  return {
    win: { startOpenMs: win.startOpenMs, endCloseMs: win.endCloseMs, barCount: win.barCount },
    sortedAll,
    replayCloses,
    firstReplayCloseIso,
    lastReplayCloseIso,
    coverage: {
      expectedBars: win.barCount,
      realBars: candleCountInReplayWindow,
      missingBars,
      syntheticBars: syntheticBarsInReplay,
      coveragePct,
    },
    warnings,
  };
}

