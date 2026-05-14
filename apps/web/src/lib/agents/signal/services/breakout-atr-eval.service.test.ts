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
});
