/**
 * P3 — deterministic ADX (Average Directional Index) helper.
 *
 * ADX measures **trend strength** (not direction). Common interpretation:
 * - `ADX < 20` ⇢ no clear trend (sideways / choppy).
 * - `ADX 20-25` ⇢ weak trend forming.
 * - `ADX > 25` ⇢ defined trend (use trend-following agents like breakout).
 * - `ADX > 40` ⇢ very strong trend (mean-reversion agents will get stopped).
 *
 * The implementation here uses Wilder's smoothing (the textbook formulation
 * by J. Welles Wilder Jr.). It is intentionally pure / synchronous so the
 * eval services can compute it on a small bar window without any I/O.
 *
 * Inputs:
 * - `barsAsc` — bars in ascending close-time order. Each bar must include
 *   `high`, `low`, and `close`.
 * - `i` — index of the target bar (0-based, must be ≥ `2 * period`).
 * - `period` — Wilder period (commonly 14).
 *
 * Returns NaN when there are not enough bars or any input is non-finite.
 */

export type AdxBar = { high: number; low: number; close: number };

export function adxAt(barsAsc: AdxBar[], i: number, period: number): number {
  if (period < 2 || i < 2 * period) return Number.NaN;
  if (!Array.isArray(barsAsc) || barsAsc.length <= i) return Number.NaN;

  // Step 1: TR, +DM, -DM per bar (starting at index 1).
  const trArr: number[] = new Array(i + 1).fill(0);
  const plusDmArr: number[] = new Array(i + 1).fill(0);
  const minusDmArr: number[] = new Array(i + 1).fill(0);
  for (let k = 1; k <= i; k += 1) {
    const cur = barsAsc[k];
    const prev = barsAsc[k - 1];
    if (
      !Number.isFinite(cur.high) ||
      !Number.isFinite(cur.low) ||
      !Number.isFinite(cur.close) ||
      !Number.isFinite(prev.close)
    ) {
      return Number.NaN;
    }
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    trArr[k] = tr;
    plusDmArr[k] = plusDm;
    minusDmArr[k] = minusDm;
  }

  // Step 2: Wilder's smoothing for the first `period`.
  let trSum = 0;
  let plusDmSum = 0;
  let minusDmSum = 0;
  for (let k = 1; k <= period; k += 1) {
    trSum += trArr[k];
    plusDmSum += plusDmArr[k];
    minusDmSum += minusDmArr[k];
  }

  // Step 3: build DX values from period+1..i and average them with Wilder.
  const dxArr: number[] = [];
  let trSmoothed = trSum;
  let plusDmSmoothed = plusDmSum;
  let minusDmSmoothed = minusDmSum;
  for (let k = period + 1; k <= i; k += 1) {
    trSmoothed = trSmoothed - trSmoothed / period + trArr[k];
    plusDmSmoothed = plusDmSmoothed - plusDmSmoothed / period + plusDmArr[k];
    minusDmSmoothed = minusDmSmoothed - minusDmSmoothed / period + minusDmArr[k];
    if (trSmoothed <= 0) {
      dxArr.push(0);
      continue;
    }
    const plusDi = (100 * plusDmSmoothed) / trSmoothed;
    const minusDi = (100 * minusDmSmoothed) / trSmoothed;
    const denom = plusDi + minusDi;
    if (denom <= 0) {
      dxArr.push(0);
      continue;
    }
    const dx = (100 * Math.abs(plusDi - minusDi)) / denom;
    dxArr.push(dx);
  }

  // Step 4: ADX = Wilder average of DX over `period` values; rolling forward.
  if (dxArr.length < period) return Number.NaN;
  let adx = dxArr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let k = period; k < dxArr.length; k += 1) {
    adx = (adx * (period - 1) + dxArr[k]) / period;
  }
  return adx;
}
