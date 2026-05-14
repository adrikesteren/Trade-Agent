import { describe, expect, it } from "vitest";

import { evaluateBreakoutAtrAtClose } from "./breakout-atr-eval.service";

describe("evaluateBreakoutAtrAtClose", () => {
  it("returns ENTER on breakout with ATR filter", () => {
    const closes = [100, 100, 100, 100, 100, 100, 103];
    const barsAsc = closes.map((base, i) => {
      return {
        high: base + 0.5,
        low: base - 0.5,
        close: base,
        closeTimeIso: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      };
    });
    const target = barsAsc[barsAsc.length - 1].closeTimeIso;
    const r = evaluateBreakoutAtrAtClose({
      barsAsc,
      targetCloseTimeIso: target,
      lookbackBars: 5,
      atrPeriod: 3,
      atrMultiplier: 1,
    });
    expect(r.intent).toBe("ENTER");
  });

  it("emits EXIT on breakdown (close below previous low by ≥ ATR multiplier)", () => {
    // Steady range, then a sharp drop that decisively breaks the prior low.
    const closes = [100, 100, 100, 100, 100, 100, 96];
    const barsAsc = closes.map((base, i) => ({
      high: base + 0.5,
      low: base - 0.5,
      close: base,
      closeTimeIso: new Date(Date.UTC(2026, 0, 2, 0, i * 15)).toISOString(),
    }));
    const target = barsAsc[barsAsc.length - 1].closeTimeIso;
    const r = evaluateBreakoutAtrAtClose({
      barsAsc,
      targetCloseTimeIso: target,
      lookbackBars: 5,
      atrPeriod: 3,
      atrMultiplier: 1,
    });
    expect(r.intent).toBe("EXIT");
  });

  it("blocks ENTER when volume confirmation gate is set and the bar is on low volume", () => {
    const closes = [100, 100, 100, 100, 100, 100, 103];
    const barsAsc = closes.map((base, i) => ({
      high: base + 0.5,
      low: base - 0.5,
      close: base,
      // 5 lookback bars at vol=1000, breakout bar at vol=200 (< 1.5× avg).
      volume: i === closes.length - 1 ? 200 : 1000,
      closeTimeIso: new Date(Date.UTC(2026, 0, 3, 0, i * 15)).toISOString(),
    }));
    const target = barsAsc[barsAsc.length - 1].closeTimeIso;
    const r = evaluateBreakoutAtrAtClose({
      barsAsc,
      targetCloseTimeIso: target,
      lookbackBars: 5,
      atrPeriod: 3,
      atrMultiplier: 1,
      volumeConfirmationMultiplier: 1.5,
      volumeLookbackBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect((r.reasons[0] ?? "").toLowerCase()).toContain("volume");
  });
});
