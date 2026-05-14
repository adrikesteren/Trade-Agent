export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type RsiBar = { close: number; closeTimeIso: string };

export type RsiEvalResult = {
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

export function evaluateRsiReversionAtClose(params: {
  barsAsc: RsiBar[];
  targetCloseTimeIso: string;
  rsiPeriod: number;
  oversold: number;
}): RsiEvalResult {
  const { barsAsc, targetCloseTimeIso, rsiPeriod, oversold } = params;
  const rule = "rsi-reversion-15m-v1";
  if (rsiPeriod < 2 || oversold <= 1 || oversold >= 50) {
    return { intent: "HOLD", confidence: null, reasons: ["invalid_params"], metadata: { rule, rsiPeriod, oversold } };
  }

  const idx = barsAsc.findIndex((b) => sameCloseTime(b.closeTimeIso, targetCloseTimeIso));
  if (idx < 0) {
    return { intent: "HOLD", confidence: null, reasons: ["target_bar_not_in_series"], metadata: { rule } };
  }
  if (idx < rsiPeriod + 1) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["insufficient_bars"],
      metadata: { rule, needBars: rsiPeriod + 2, haveBars: idx + 1 },
    };
  }

  const closes = barsAsc.slice(0, idx + 1).map((b) => b.close);
  const prevRsi = rsiAt(closes.slice(0, -1), rsiPeriod);
  const currRsi = rsiAt(closes, rsiPeriod);
  if (!Number.isFinite(prevRsi) || !Number.isFinite(currRsi)) {
    return { intent: "HOLD", confidence: null, reasons: ["non_finite_rsi"], metadata: { rule, prevRsi, currRsi } };
  }

  const crossedUp = prevRsi <= oversold && currRsi > oversold;
  if (!crossedUp) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: [`no_rsi_reversion period=${rsiPeriod} oversold=${oversold}`],
      metadata: { rule, prevRsi, currRsi, oversold, rsiPeriod },
    };
  }

  const confidence = Math.min(1, Math.max(0.25, (currRsi - oversold) / 20));
  return {
    intent: "ENTER",
    confidence,
    reasons: [`rsi_reversion_up period=${rsiPeriod} oversold=${oversold}`],
    metadata: { rule, prevRsi, currRsi, oversold, rsiPeriod },
  };
}
