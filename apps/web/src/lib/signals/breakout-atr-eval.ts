export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type BreakoutAtrBar = { high: number; low: number; close: number; closeTimeIso: string };

export type BreakoutAtrEvalResult = {
  intent: SignalIntent;
  confidence: number | null;
  reasons: string[];
  metadata: Record<string, unknown>;
};

function sameCloseTime(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta - tb) < 2000;
  return a === b;
}

function atrAt(barsAsc: BreakoutAtrBar[], i: number, period: number): number {
  if (i < period || period < 1) return Number.NaN;
  let sumTr = 0;
  for (let k = i - period + 1; k <= i; k += 1) {
    const cur = barsAsc[k];
    const prevClose = barsAsc[k - 1]?.close ?? cur.close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    sumTr += tr;
  }
  return sumTr / period;
}

export function evaluateBreakoutAtrAtClose(params: {
  barsAsc: BreakoutAtrBar[];
  targetCloseTimeIso: string;
  lookbackBars: number;
  atrPeriod: number;
  atrMultiplier: number;
}): BreakoutAtrEvalResult {
  const { barsAsc, targetCloseTimeIso, lookbackBars, atrPeriod, atrMultiplier } = params;
  const rule = "breakout-atr-15m-v1";
  if (lookbackBars < 2 || atrPeriod < 2 || atrMultiplier <= 0) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["invalid_params"],
      metadata: { rule, lookbackBars, atrPeriod, atrMultiplier },
    };
  }
  const idx = barsAsc.findIndex((b) => sameCloseTime(b.closeTimeIso, targetCloseTimeIso));
  if (idx < 0) return { intent: "HOLD", confidence: null, reasons: ["target_bar_not_in_series"], metadata: { rule } };
  if (idx < Math.max(lookbackBars, atrPeriod) + 1) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["insufficient_bars"],
      metadata: { rule, needBars: Math.max(lookbackBars, atrPeriod) + 2, haveBars: idx + 1 },
    };
  }

  const prevWindow = barsAsc.slice(idx - lookbackBars, idx);
  const prevHigh = Math.max(...prevWindow.map((b) => b.close));
  const currClose = barsAsc[idx].close;
  const atr = atrAt(barsAsc, idx, atrPeriod);
  if (!Number.isFinite(currClose) || !Number.isFinite(prevHigh) || !Number.isFinite(atr) || atr <= 0) {
    return { intent: "HOLD", confidence: null, reasons: ["non_finite_metrics"], metadata: { rule, prevHigh, currClose, atr } };
  }

  const breakoutDistance = currClose - prevHigh;
  const minDistance = atrMultiplier * atr;
  const crossed = currClose > prevHigh && breakoutDistance >= minDistance;
  if (!crossed) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: [`no_breakout_atr lookback=${lookbackBars} atrPeriod=${atrPeriod} atrMul=${atrMultiplier}`],
      metadata: { rule, prevHigh, currClose, atr, breakoutDistance, minDistance },
    };
  }

  const confidence = Math.min(1, Math.max(0.25, breakoutDistance / Math.max(minDistance, 1e-9)));
  return {
    intent: "ENTER",
    confidence,
    reasons: [`breakout_atr lookback=${lookbackBars} atrPeriod=${atrPeriod} atrMul=${atrMultiplier}`],
    metadata: { rule, prevHigh, currClose, atr, breakoutDistance, minDistance },
  };
}
