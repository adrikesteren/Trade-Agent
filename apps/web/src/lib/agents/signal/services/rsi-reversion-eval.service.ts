import { adxAt } from "@/lib/markets/adx";
import { passesVolatilityGate } from "@/lib/markets/atr-volatility-gate";

export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type RsiBar = {
  close: number;
  closeTimeIso: string;
  /** Optional — when present, used by the volatility gate to compute true ATR. */
  high?: number;
  /** Optional — when present, used by the volatility gate to compute true ATR. */
  low?: number;
};

export type RsiEvalResult = {
  intent: SignalIntent;
  /**
   * P3: which side this signal would take if its intent is ENTER. Defaults to "long" when omitted.
   * The RSI-reversion agent only emits long entries today, so this stays "long" or undefined.
   */
  signalSide?: "long" | "short";
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

/**
 * P3: ATR computed from `high`/`low` when present; NaN otherwise.
 * Mirrors the helper in ma-cross-eval / breakout-atr-eval but kept local
 * so each agent stays self-contained.
 */
function atrAt(barsAsc: RsiBar[], i: number, period: number): number {
  if (i < period || period < 1) return Number.NaN;
  let sumTr = 0;
  for (let k = i - period + 1; k <= i; k += 1) {
    const cur = barsAsc[k];
    if (typeof cur.high !== "number" || typeof cur.low !== "number") return Number.NaN;
    const prevClose = barsAsc[k - 1]?.close ?? cur.close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    sumTr += tr;
  }
  return sumTr / period;
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
  /** P3: when set, EXIT is emitted on cross-down through this overbought level. Defaults to disabled. */
  overbought?: number | null;
  /** Optional volatility-gate bounds (P3). */
  minAtrPct?: number | null;
  maxAtrPct?: number | null;
  /** Optional ATR period for the gate (defaults to `rsiPeriod`). */
  atrPeriod?: number;
  /**
   * P3: when set, ENTERs are skipped when ADX(period) is **above** this
   * threshold. Mean-reversion is unsafe in strong trends; the typical
   * threshold is 25 (textbook "trending market" line).
   */
  maxAdx?: number | null;
  /** ADX period for the trend filter (defaults to `rsiPeriod`). */
  adxPeriod?: number;
}): RsiEvalResult {
  const {
    barsAsc,
    targetCloseTimeIso,
    rsiPeriod,
    oversold,
    overbought,
    minAtrPct,
    maxAtrPct,
    atrPeriod,
    maxAdx,
    adxPeriod,
  } = params;
  const rule = "rsi-reversion-15m-v1";
  if (rsiPeriod < 2 || oversold <= 1 || oversold >= 50) {
    return { intent: "HOLD", confidence: null, reasons: ["invalid_params"], metadata: { rule, rsiPeriod, oversold } };
  }
  if (typeof overbought === "number" && (overbought <= 50 || overbought >= 99)) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: ["invalid_overbought"],
      metadata: { rule, rsiPeriod, oversold, overbought },
    };
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

  // P3: EXIT on cross-down through overbought (when configured).
  if (typeof overbought === "number") {
    const crossedDownOver = prevRsi >= overbought && currRsi < overbought;
    if (crossedDownOver) {
      const confidence = Math.min(1, Math.max(0.25, (overbought - currRsi) / 20));
      return {
        intent: "EXIT",
        signalSide: "long",
        confidence,
        reasons: [`rsi_overbought_exit period=${rsiPeriod} overbought=${overbought}`],
        metadata: { rule, prevRsi, currRsi, oversold, overbought, rsiPeriod },
      };
    }
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

  const gateConfigured =
    (typeof minAtrPct === "number" && Number.isFinite(minAtrPct)) ||
    (typeof maxAtrPct === "number" && Number.isFinite(maxAtrPct));
  if (gateConfigured) {
    const period = Math.max(2, Math.floor(atrPeriod ?? rsiPeriod));
    const atr = atrAt(barsAsc, idx, period);
    if (Number.isFinite(atr)) {
      const gate = passesVolatilityGate({ atr, price: barsAsc[idx].close, minAtrPct, maxAtrPct });
      if (!gate.pass) {
        return {
          intent: "HOLD",
          confidence: null,
          reasons: [`volatility_gate_${gate.reason}`],
          metadata: {
            rule,
            prevRsi,
            currRsi,
            oversold,
            rsiPeriod,
            atr,
            atrPct: gate.atrPct,
            minAtrPct: minAtrPct ?? null,
            maxAtrPct: maxAtrPct ?? null,
          },
        };
      }
    }
  }

  // P3: ADX trend filter — mean-reversion is unsafe in strong trends.
  if (typeof maxAdx === "number" && Number.isFinite(maxAdx)) {
    const adxBars = barsAsc
      .slice(0, idx + 1)
      .map((b) => ({ high: b.high ?? b.close, low: b.low ?? b.close, close: b.close }));
    const period = Math.max(2, Math.floor(adxPeriod ?? rsiPeriod));
    const adx = adxAt(adxBars, idx, period);
    if (Number.isFinite(adx) && adx > maxAdx) {
      return {
        intent: "HOLD",
        confidence: null,
        reasons: [`adx_too_high adx=${adx.toFixed(1)} maxAdx=${maxAdx}`],
        metadata: { rule, prevRsi, currRsi, oversold, rsiPeriod, adx, maxAdx },
      };
    }
  }

  const confidence = Math.min(1, Math.max(0.25, (currRsi - oversold) / 20));
  return {
    intent: "ENTER",
    confidence,
    reasons: [`rsi_reversion_up period=${rsiPeriod} oversold=${oversold}`],
    metadata: { rule, prevRsi, currRsi, oversold, rsiPeriod },
  };
}
