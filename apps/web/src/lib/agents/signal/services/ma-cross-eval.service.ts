import { passesVolatilityGate } from "@/lib/markets/atr-volatility-gate";

export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type MaCrossBar = {
  close: number;
  closeTimeIso: string;
  /** Optional — when present, used by the volatility gate to compute true ATR. */
  high?: number;
  /** Optional — when present, used by the volatility gate to compute true ATR. */
  low?: number;
};

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

export type SignalSide = "long" | "short";

export type MaCrossEvalResult = {
  intent: SignalIntent;
  /**
   * P3: which side this signal would take if its intent is ENTER. Defaults to "long" when omitted.
   * The MA-cross agent only emits long entries today, so this stays "long" or undefined.
   */
  signalSide?: SignalSide;
  confidence: number | null;
  reasons: string[];
  metadata: Record<string, unknown>;
};

/**
 * P3: compute ATR at index `i` over `period` bars when high/low are present.
 * Falls back to NaN when high/low are missing (so the volatility gate becomes
 * a no-op rather than rejecting valid signals).
 */
function atrAt(barsAsc: MaCrossBar[], i: number, period: number): number {
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

/**
 * Bullish MA cross at the bar whose close time matches `targetCloseTimeIso`:
 * fast SMA crosses above slow SMA on that bar (vs previous bar).
 *
 * Optionally gated by ATR-as-percentage-of-price (`minAtrPct` / `maxAtrPct`).
 * The gate is only effective when bars include `high` / `low`; with close-only
 * bars the gate becomes a no-op (returns true) rather than rejecting.
 */
export function evaluateMaCrossAtClose(params: {
  barsAsc: MaCrossBar[];
  targetCloseTimeIso: string;
  fastPeriod: number;
  slowPeriod: number;
  /** Optional volatility-gate bounds (P3). */
  minAtrPct?: number | null;
  maxAtrPct?: number | null;
  /** Optional ATR period for the gate (defaults to slowPeriod). */
  atrPeriod?: number;
}): MaCrossEvalResult {
  const { barsAsc, targetCloseTimeIso, fastPeriod, slowPeriod, minAtrPct, maxAtrPct, atrPeriod } = params;
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
  const crossedDown = fPrev >= sPrev && fCurr < sCurr;

  if (crossedDown) {
    const denom = Math.abs(sCurr) > 1e-12 ? Math.abs(sCurr) : 1;
    const strength = Math.abs(fCurr - sCurr) / denom;
    const confidence = Math.min(1, Math.max(0.25, strength));
    return {
      intent: "EXIT",
      signalSide: "long",
      confidence,
      reasons: [`ma_cross_down fast=${fastPeriod} slow=${slowPeriod}`],
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

  if (crossedUp) {
    const gateConfigured =
      (typeof minAtrPct === "number" && Number.isFinite(minAtrPct)) ||
      (typeof maxAtrPct === "number" && Number.isFinite(maxAtrPct));
    if (gateConfigured) {
      const period = Math.max(2, Math.floor(atrPeriod ?? slowPeriod));
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
              fastPeriod,
              slowPeriod,
              fastMa: fCurr,
              slowMa: sCurr,
              fastMaPrev: fPrev,
              slowMaPrev: sPrev,
              atr,
              atrPct: gate.atrPct,
              minAtrPct: minAtrPct ?? null,
              maxAtrPct: maxAtrPct ?? null,
            },
          };
        }
      }
    }

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
