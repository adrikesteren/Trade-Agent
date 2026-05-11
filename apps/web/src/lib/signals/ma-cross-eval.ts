export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type MaCrossBar = { close: number; closeTimeIso: string };

function sma(closes: number[]): number {
  if (closes.length === 0) return NaN;
  let s = 0;
  for (const c of closes) s += c;
  return s / closes.length;
}

function sameCloseTime(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta - tb) < 2000;
  return a === b;
}

/**
 * Simple moving average at index `i` using closes [i - period + 1, i] inclusive.
 */
function smaAt(barsAsc: MaCrossBar[], i: number, period: number): number {
  const from = i - period + 1;
  if (from < 0) return NaN;
  const closes = barsAsc.slice(from, i + 1).map((b) => b.close);
  return sma(closes);
}

export type MaCrossEvalResult = {
  intent: SignalIntent;
  confidence: number | null;
  reasons: string[];
  metadata: Record<string, unknown>;
};

/**
 * Bullish MA cross at the bar whose close time matches `targetCloseTimeIso`:
 * fast SMA crosses above slow SMA on that bar (vs previous bar).
 */
export function evaluateMaCrossAtClose(params: {
  barsAsc: MaCrossBar[];
  targetCloseTimeIso: string;
  fastPeriod: number;
  slowPeriod: number;
}): MaCrossEvalResult {
  const { barsAsc, targetCloseTimeIso, fastPeriod, slowPeriod } = params;
  const rule = "ma-cross-15m-v1";

  if (fastPeriod < 1 || slowPeriod < 2 || fastPeriod >= slowPeriod) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["invalid_ma_periods"],
      metadata: { rule, fastPeriod, slowPeriod },
    };
  }

  const idx = barsAsc.findIndex((b) => sameCloseTime(b.closeTimeIso, targetCloseTimeIso));
  if (idx < 0) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["target_bar_not_in_series"],
      metadata: { rule, targetCloseTimeIso },
    };
  }

  if (idx < slowPeriod) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["insufficient_bars"],
      metadata: { rule, needBars: slowPeriod + 1, haveBars: idx + 1 },
    };
  }

  const fPrev = smaAt(barsAsc, idx - 1, fastPeriod);
  const fCurr = smaAt(barsAsc, idx, fastPeriod);
  const sPrev = smaAt(barsAsc, idx - 1, slowPeriod);
  const sCurr = smaAt(barsAsc, idx, slowPeriod);

  if (![fPrev, fCurr, sPrev, sCurr].every((x) => Number.isFinite(x))) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["non_finite_ma"],
      metadata: { rule, fPrev, fCurr, sPrev, sCurr },
    };
  }

  const crossedUp = fPrev <= sPrev && fCurr > sCurr;

  if (crossedUp) {
    const denom = Math.abs(sCurr) > 1e-12 ? Math.abs(sCurr) : 1;
    const strength = Math.abs(fCurr - sCurr) / denom;
    const confidence = Math.min(1, Math.max(0.25, strength));
    return {
      intent: "ENTER",
      confidence,
      reasons: [`ma_cross_up fast=${fastPeriod} slow=${slowPeriod}`],
      metadata: {
        rule,
        fastPeriod,
        slowPeriod,
        fastMa: fCurr,
        slowMa: sCurr,
        fastMaPrev: fPrev,
        slowMaPrev: sPrev,
      },
    };
  }

  return {
    intent: "HOLD",
    confidence: null,
    reasons: [`no_ma_cross fast=${fastPeriod} slow=${slowPeriod}`],
    metadata: {
      rule,
      fastPeriod,
      slowPeriod,
      fastMa: fCurr,
      slowMa: sCurr,
      fastMaPrev: fPrev,
      slowMaPrev: sPrev,
    },
  };
}
