/**
 * P3 — multi-timeframe confluence agent.
 *
 * Combines a higher-timeframe trend filter (e.g. 4h MA) with a lower-timeframe
 * entry trigger (e.g. 15m RSI oversold). The agent only emits `ENTER` when
 * both legs align; otherwise it returns `HOLD`.
 *
 * Why: single-timeframe entries (RSI on 15m alone) tend to fade in strong
 * downtrends because they ignore the bigger picture. Requiring confluence
 * with the 4h MA dramatically reduces false positives in bear markets.
 *
 * Inputs:
 * - `trendBarsAsc` — bars on the higher timeframe (default daily / 4h).
 * - `entryBarsAsc` — bars on the entry timeframe (default 15m).
 * - both slices must be ascending and include the bars covering the target
 *   close time.
 *
 * Decision:
 * - Trend leg: `close(trend bar covering target) > SMA(close, trendMa)` for `long`.
 *   We only emit `long` confluence today (short would require the inverse).
 * - Entry leg: RSI(period) on `entryBarsAsc` crosses up through `entryRsi`
 *   at the target bar (same logic as `rsi-reversion-eval.service.ts`).
 *
 * Result:
 * - `intent='ENTER'` when both legs pass; `signalSide='long'`.
 * - `intent='HOLD'` otherwise; `signalSide='long'` (default; the agent never
 *   recommends short — that's the regime classifier / future short-bias agent).
 *
 * The helper is **pure**; the upserter / dispatcher is responsible for
 * aggregating 15m bars into 4h / daily bars before calling.
 */

export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type MultiTfBar = { close: number; closeTimeIso: string };

export type MultiTfConfluenceEvalResult = {
  intent: SignalIntent;
  signalSide?: "long" | "short";
  confidence: number | null;
  reasons: string[];
  metadata: Record<string, unknown>;
};

function smaTail(closes: number[], period: number): number {
  if (closes.length < period || period < 2) return Number.NaN;
  let s = 0;
  for (let k = closes.length - period; k < closes.length; k += 1) s += closes[k];
  return s / period;
}

function rsiAt(closes: number[], period: number): number {
  if (closes.length < period + 1) return Number.NaN;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    const d = cur - prev;
    if (d >= 0) gains += d;
    else losses += -d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss <= 1e-12) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Find the index of the trend-timeframe bar that **contains** the entry bar's
 * close time. Trend bars are coarser (4h / daily), so any entry bar at time T
 * belongs to the trend bar with the largest closeTimeIso ≤ T.
 *
 * Returns -1 when no such trend bar exists.
 */
function indexOfCoveringTrendBar(trendBarsAsc: MultiTfBar[], targetIso: string): number {
  const tt = Date.parse(targetIso);
  if (!Number.isFinite(tt)) return -1;
  let lastIdx = -1;
  for (let i = 0; i < trendBarsAsc.length; i += 1) {
    const ti = Date.parse(trendBarsAsc[i].closeTimeIso);
    if (Number.isFinite(ti) && ti <= tt) lastIdx = i;
    else break;
  }
  return lastIdx;
}

function sameCloseTime(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta - tb) < 2000;
  return a === b;
}

export function evaluateMultiTfConfluenceAtClose(params: {
  trendBarsAsc: MultiTfBar[];
  entryBarsAsc: MultiTfBar[];
  targetCloseTimeIso: string;
  /** SMA period on the higher timeframe (default 50 → 4h MA50). */
  trendMa: number;
  /** RSI period on the entry timeframe (default 14). */
  entryRsiPeriod: number;
  /** RSI threshold to cross up through on the entry leg (default 30). */
  entryRsi: number;
}): MultiTfConfluenceEvalResult {
  const { trendBarsAsc, entryBarsAsc, targetCloseTimeIso, trendMa, entryRsiPeriod, entryRsi } = params;
  const rule = "multi-tf-confluence-15m-v1";

  if (trendMa < 2 || entryRsiPeriod < 2 || entryRsi <= 1 || entryRsi >= 50) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["invalid_params"],
      metadata: { rule, trendMa, entryRsiPeriod, entryRsi },
    };
  }

  const entryIdx = entryBarsAsc.findIndex((b) => sameCloseTime(b.closeTimeIso, targetCloseTimeIso));
  if (entryIdx < 0) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["target_bar_not_in_entry_series"],
      metadata: { rule, targetCloseTimeIso },
    };
  }
  if (entryIdx < entryRsiPeriod + 1) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["insufficient_entry_bars"],
      metadata: { rule, needEntryBars: entryRsiPeriod + 2, haveEntryBars: entryIdx + 1 },
    };
  }

  const trendIdx = indexOfCoveringTrendBar(trendBarsAsc, targetCloseTimeIso);
  if (trendIdx < trendMa - 1) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["insufficient_trend_bars"],
      metadata: { rule, needTrendBars: trendMa, haveTrendBars: trendIdx + 1 },
    };
  }

  const trendCloses = trendBarsAsc.slice(0, trendIdx + 1).map((b) => b.close);
  const ma = smaTail(trendCloses, trendMa);
  const trendClose = trendCloses[trendCloses.length - 1];
  if (![ma, trendClose].every((x) => Number.isFinite(x)) || ma <= 0) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["non_finite_trend_metrics"],
      metadata: { rule, ma, trendClose },
    };
  }
  const trendUp = trendClose > ma;

  const entryCloses = entryBarsAsc.slice(0, entryIdx + 1).map((b) => b.close);
  const prevRsi = rsiAt(entryCloses.slice(0, -1), entryRsiPeriod);
  const currRsi = rsiAt(entryCloses, entryRsiPeriod);
  if (!Number.isFinite(prevRsi) || !Number.isFinite(currRsi)) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["non_finite_entry_rsi"],
      metadata: { rule, prevRsi, currRsi },
    };
  }
  const entryCrossUp = prevRsi <= entryRsi && currRsi > entryRsi;

  if (!trendUp || !entryCrossUp) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: [`no_confluence trendUp=${trendUp} entryCrossUp=${entryCrossUp}`],
      metadata: { rule, ma, trendClose, prevRsi, currRsi, trendMa, entryRsiPeriod, entryRsi },
    };
  }

  // Confidence reflects how strong each leg is, averaged.
  const trendStrength = Math.min(1, Math.abs(trendClose - ma) / Math.max(ma, 1e-9) / 0.05);
  const rsiStrength = Math.min(1, (currRsi - entryRsi) / 20);
  const confidence = Math.min(1, Math.max(0.25, (trendStrength + rsiStrength) / 2));

  return {
    intent: "ENTER",
    signalSide: "long",
    confidence,
    reasons: [`mtf_confluence trendMa=${trendMa} entryRsi=${entryRsi}`],
    metadata: { rule, ma, trendClose, prevRsi, currRsi, trendMa, entryRsiPeriod, entryRsi },
  };
}
