import { adxAt } from "@/lib/markets/adx";
import { passesVolatilityGate } from "@/lib/markets/atr-volatility-gate";

export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type BreakoutAtrBar = {
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
  /** Optional — when present, used by the volume-confirmation gate. */
  volume?: number;
};

export type BreakoutAtrEvalResult = {
  intent: SignalIntent;
  /**
   * P3: which side this signal would take if its intent is ENTER. Defaults to "long" when omitted.
   * The breakout-ATR agent only emits long entries today, so this stays "long" or undefined.
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
  /** Optional volatility-gate bounds (P3). */
  minAtrPct?: number | null;
  maxAtrPct?: number | null;
  /**
   * P3: when set, an ENTER breakout is only emitted if the target bar's
   * volume exceeds `avg(volume over volumeLookbackBars)` × this multiplier.
   * Defaults to disabled (no volume gating).
   */
  volumeConfirmationMultiplier?: number | null;
  /** Number of bars to average volume over (defaults to `lookbackBars`). */
  volumeLookbackBars?: number;
  /**
   * P3: when set, ENTERs are skipped when `ADX(adxPeriod)` is **below** this
   * threshold. Breakouts only have edge inside an established trend; the
   * canonical threshold is 25.
   */
  minAdx?: number | null;
  /** ADX period for the trend filter (defaults to `atrPeriod`). */
  adxPeriod?: number;
}): BreakoutAtrEvalResult {
  const {
    barsAsc,
    targetCloseTimeIso,
    lookbackBars,
    atrPeriod,
    atrMultiplier,
    minAtrPct,
    maxAtrPct,
    volumeConfirmationMultiplier,
    volumeLookbackBars,
    minAdx,
    adxPeriod,
  } = params;
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

  // P3: emit EXIT when price breaks the prior-window low by ≥ atrMul*ATR
  // ("breakout failure" — symmetric to the entry condition). Pre-P3 we relied
  // on the executor's moving floor for exits, which was lagging.
  const prevLow = Math.min(...prevWindow.map((b) => b.close));
  if (Number.isFinite(prevLow) && currClose < prevLow) {
    const breakdownDistance = prevLow - currClose;
    if (breakdownDistance >= minDistance) {
      const confidence = Math.min(1, Math.max(0.25, breakdownDistance / Math.max(minDistance, 1e-9)));
      return {
        intent: "EXIT",
        signalSide: "long",
        confidence,
        reasons: [`breakout_failure lookback=${lookbackBars} atrPeriod=${atrPeriod} atrMul=${atrMultiplier}`],
        metadata: { rule, prevLow, currClose, atr, breakdownDistance, minDistance },
      };
    }
  }

  if (!crossed) {
    return {
      intent: "HOLD",
      confidence: null,
      reasons: [`no_breakout_atr lookback=${lookbackBars} atrPeriod=${atrPeriod} atrMul=${atrMultiplier}`],
      metadata: { rule, prevHigh, currClose, atr, breakoutDistance, minDistance },
    };
  }

  const gateConfigured =
    (typeof minAtrPct === "number" && Number.isFinite(minAtrPct)) ||
    (typeof maxAtrPct === "number" && Number.isFinite(maxAtrPct));
  if (gateConfigured) {
    const gate = passesVolatilityGate({ atr, price: currClose, minAtrPct, maxAtrPct });
    if (!gate.pass) {
      return {
        intent: "HOLD",
        confidence: null,
        reasons: [`volatility_gate_${gate.reason}`],
        metadata: {
          rule,
          prevHigh,
          currClose,
          atr,
          breakoutDistance,
          minDistance,
          atrPct: gate.atrPct,
          minAtrPct: minAtrPct ?? null,
          maxAtrPct: maxAtrPct ?? null,
        },
      };
    }
  }

  // P3: volume confirmation gate. Skip the breakout when volume is missing or
  // below the configured multiple of the recent average. Pre-P3 the agent
  // entered on price alone, which gave many false positives on illiquid bars.
  if (typeof volumeConfirmationMultiplier === "number" && volumeConfirmationMultiplier > 0) {
    const lookN = Math.max(2, Math.floor(volumeLookbackBars ?? lookbackBars));
    const fromIdx = Math.max(0, idx - lookN);
    const window = barsAsc.slice(fromIdx, idx);
    const allVolumes = window.map((b) => b.volume);
    const haveAllVolumes = allVolumes.every((v) => typeof v === "number" && Number.isFinite(v));
    const targetVolume = barsAsc[idx].volume;
    if (!haveAllVolumes || typeof targetVolume !== "number" || !Number.isFinite(targetVolume)) {
      return {
        intent: "HOLD",
        confidence: null,
        reasons: ["volume_confirmation_missing"],
        metadata: {
          rule,
          prevHigh,
          currClose,
          atr,
          breakoutDistance,
          minDistance,
          volumeConfirmationMultiplier,
        },
      };
    }
    const avgVolume = (allVolumes as number[]).reduce((s, v) => s + v, 0) / window.length;
    const required = avgVolume * volumeConfirmationMultiplier;
    if (targetVolume < required) {
      return {
        intent: "HOLD",
        confidence: null,
        reasons: [`volume_confirmation_below mul=${volumeConfirmationMultiplier}`],
        metadata: {
          rule,
          prevHigh,
          currClose,
          atr,
          breakoutDistance,
          minDistance,
          targetVolume,
          avgVolume,
          required,
          volumeConfirmationMultiplier,
        },
      };
    }
  }

  // P3: ADX trend filter — breakouts only have edge inside a real trend.
  if (typeof minAdx === "number" && Number.isFinite(minAdx)) {
    const period = Math.max(2, Math.floor(adxPeriod ?? atrPeriod));
    const adx = adxAt(barsAsc, idx, period);
    if (Number.isFinite(adx) && adx < minAdx) {
      return {
        intent: "HOLD",
        confidence: null,
        reasons: [`adx_too_low adx=${adx.toFixed(1)} minAdx=${minAdx}`],
        metadata: { rule, prevHigh, currClose, atr, breakoutDistance, minDistance, adx, minAdx },
      };
    }
  }

  const confidence = Math.min(1, Math.max(0.25, breakoutDistance / Math.max(minDistance, 1e-9)));
  return {
    intent: "ENTER",
    confidence,
    reasons: [`breakout_atr lookback=${lookbackBars} atrPeriod=${atrPeriod} atrMul=${atrMultiplier}`],
    metadata: { rule, prevHigh, currClose, atr, breakoutDistance, minDistance },
  };
}
