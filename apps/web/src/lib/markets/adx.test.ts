import { describe, expect, it } from "vitest";

import { adxAt, type AdxBar } from "./adx";

function uptrend(n: number, start = 100, step = 0.5): AdxBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { high: close + 0.2, low: close - 0.2, close };
  });
}

function flat(n: number, value = 100): AdxBar[] {
  return Array.from({ length: n }, () => ({ high: value, low: value, close: value }));
}

describe("adxAt", () => {
  it("returns NaN when there are not enough bars", () => {
    expect(adxAt(uptrend(20), 19, 14)).toBeNaN();
  });

  it("returns NaN for invalid period", () => {
    expect(adxAt(uptrend(60), 59, 1)).toBeNaN();
  });

  it("returns 0 (or near zero) on a perfectly flat series — no trend", () => {
    const bars = flat(60);
    const adx = adxAt(bars, 59, 14);
    expect(adx).toBeGreaterThanOrEqual(0);
    expect(adx).toBeLessThanOrEqual(5);
  });

  it("returns a high ADX on a clean uninterrupted uptrend", () => {
    const bars = uptrend(120, 100, 0.5);
    const adx = adxAt(bars, 119, 14);
    expect(adx).toBeGreaterThan(40);
  });

  it("returns a finite ADX in [0, 100]", () => {
    const adx = adxAt(uptrend(80), 79, 14);
    expect(Number.isFinite(adx)).toBe(true);
    expect(adx).toBeGreaterThanOrEqual(0);
    expect(adx).toBeLessThanOrEqual(100);
  });
});
