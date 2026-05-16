/**
 * P3 — regime classifier (price vs daily MA200 + slope).
 *
 * The classifier never trades alone. Its purpose is to label every bar as
 * `bull` / `bear` / `sideways` so the mediator can:
 * - gate other agents (only allow ENTER signals when regime is bull/bear),
 * - drive Stop-and-Reverse (SAR) on confirmed regime flips.
 *
 * Definition (deterministic, single-timeframe input — daily aggregated bars):
 * - Compute `MA = SMA(close, maPeriod)` at the target bar.
 * - `distancePct = (close - MA) / MA`.
 * - `slopeAbs = (MA[i] - MA[i - slopeBars]) / slopeBars` (per-bar drift).
 * - `slopePct = slopeAbs / MA[i]`.
 * - Decision:
 *   - `bull`  ⇢ `close > MA` AND `slopePct > +slopePctEps`
 *   - `bear`  ⇢ `close < MA` AND `slopePct < -slopePctEps`
 *   - `sideways` otherwise (price near MA OR slope flat)
 *
 * Output `intent` is always `HOLD`. The mediator reads `metadata.regime` and
 * `signalSide` (long for bull, short for bear, long-as-default for sideways).
 *
 * Notes:
 * - Inputs are bars **already aggregated to the trend timeframe** (typically
 *   `daily`). Aggregation happens in the dispatcher / upserter — this helper
 *   is intentionally pure and stateless.
 * - `slopeBars` is in bars-of-the-trend-timeframe (so `slopeBars=5` on
 *   `daily` ≈ "trailing 5 days").
 */

export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type RegimeClassifierBar = {
  close: number;
  closeTimeIso: string;
};

export type RegimeLabel = "bull" | "bear" | "sideways";

export type RegimeClassifierEvalResult = {
  intent: SignalIntent;
  /**
   * P3: which side the regime favors. `long` for bull (and sideways default),
   * `short` for bear. Mediator uses this together with `metadata.regime`.
   */
  signalSide?: "long" | "short";
  confidence: number | null;
  reasons: string[];
  metadata: Record<string, unknown> & { regime: RegimeLabel };
};

function sameCloseTime(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    // Trend-timeframe bars (daily) are far apart; allow generous match window.
    return Math.abs(ta - tb) < 12 * 60 * 60 * 1000;
  }
  return a === b;
}

function smaAt(barsAsc: RegimeClassifierBar[], i: number, period: number): number {
  if (i < period - 1 || period < 2) return Number.NaN;
  let s = 0;
  for (let k = i - period + 1; k <= i; k += 1) s += barsAsc[k].close;
  return s / period;
}

export function evaluateRegimeAtClose(params: {
  /** Trend-timeframe bars, ascending (caller aggregates 15m → trend tf). Must include the target bar. */
  barsAsc: RegimeClassifierBar[];
  targetCloseTimeIso: string;
  /** SMA period in trend-timeframe bars (default seed = 200). */
  maPeriod: number;
  /** Slope lookback in trend-timeframe bars (default seed = 20). */
  slopeBars: number;
  /**
   * Trend-timeframe bar length in minutes (e.g. `1440` for daily, `240` for 4h, `60` for 1h).
   * Recorded in `metadata.trendTimeframeMinutes` so the chart / debugger knows which
   * timeframe the SMA was computed on.
   */
  trendTimeframeMinutes: number;
  /**
   * Minimum |slopePct| to consider the trend "directional".
   * Below this, regime is `sideways` regardless of price-vs-MA.
   * Defaults to 0.0005 (~0.05% per bar on the trend timeframe).
   */
  slopePctEps?: number;
  /**
   * Minimum |distancePct| (price vs MA) to consider regime non-sideways.
   * Defaults to 0.005 (0.5%) — chop near the MA stays sideways.
   */
  distancePctEps?: number;
}): RegimeClassifierEvalResult {
  const {
    barsAsc,
    targetCloseTimeIso,
    maPeriod,
    slopeBars,
    trendTimeframeMinutes,
    slopePctEps = 0.0005,
    distancePctEps = 0.005,
  } = params;
  const rule = "regime-classifier-15m-v1";

  if (maPeriod < 2 || slopeBars < 1) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["invalid_params"],
      metadata: { rule, regime: "sideways", maPeriod, slopeBars, trendTimeframeMinutes },
    };
  }

  const idx = barsAsc.findIndex((b) => sameCloseTime(b.closeTimeIso, targetCloseTimeIso));
  if (idx < 0) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["target_bar_not_in_series"],
      metadata: { rule, regime: "sideways", targetCloseTimeIso, trendTimeframeMinutes },
    };
  }

  const needed = Math.max(maPeriod - 1, slopeBars);
  if (idx < needed) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["insufficient_bars"],
      metadata: {
        rule,
        regime: "sideways",
        needBars: needed + 1,
        haveBars: idx + 1,
        trendTimeframeMinutes,
      },
    };
  }

  const maNow = smaAt(barsAsc, idx, maPeriod);
  const maPrev = smaAt(barsAsc, Math.max(0, idx - slopeBars), maPeriod);
  const closeNow = barsAsc[idx].close;

  if (![maNow, maPrev, closeNow].every((x) => Number.isFinite(x)) || maNow <= 0) {
    return {
      intent: "HOLD",
      signalSide: "long",
      confidence: null,
      reasons: ["non_finite_metrics"],
      metadata: { rule, regime: "sideways", maNow, maPrev, closeNow, trendTimeframeMinutes },
    };
  }

  const distancePct = (closeNow - maNow) / maNow;
  const slopeAbs = (maNow - maPrev) / slopeBars;
  const slopePct = slopeAbs / maNow;

  let regime: RegimeLabel = "sideways";
  let signalSide: "long" | "short" = "long";
  if (Math.abs(distancePct) < distancePctEps || Math.abs(slopePct) < slopePctEps) {
    regime = "sideways";
    signalSide = "long";
  } else if (closeNow > maNow && slopePct > slopePctEps) {
    regime = "bull";
    signalSide = "long";
  } else if (closeNow < maNow && slopePct < -slopePctEps) {
    regime = "bear";
    signalSide = "short";
  } else {
    regime = "sideways";
    signalSide = "long";
  }

  // Confidence reflects how strongly the trend leans. We combine the
  // distance-from-MA and slope magnitudes, both already in fractional form,
  // and clamp to [0.25, 1].
  const rawStrength = Math.min(Math.abs(distancePct), 0.2) / 0.2 +
    Math.min(Math.abs(slopePct), 0.005) / 0.005;
  const confidence = regime === "sideways" ? null : Math.min(1, Math.max(0.25, rawStrength / 2));

  return {
    intent: "HOLD",
    signalSide,
    confidence,
    reasons: [`regime=${regime} maPeriod=${maPeriod} slopeBars=${slopeBars} tf=${trendTimeframeMinutes}m`],
    metadata: {
      rule,
      regime,
      maPeriod,
      slopeBars,
      trendTimeframeMinutes,
      maNow,
      maPrev,
      closeNow,
      distancePct,
      slopePct,
    },
  };
}
