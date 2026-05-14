import { describe, expect, it } from "vitest";

import { evaluateRsiReversionAtClose } from "./rsi-reversion-eval.service";

describe("evaluateRsiReversionAtClose", () => {
  it("returns ENTER when RSI crosses up oversold", () => {
    const barsAsc = [100, 90, 80, 70, 90].map((close, i) => ({
      close,
      closeTimeIso: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
    }));
    const target = barsAsc[barsAsc.length - 1].closeTimeIso;
    const r = evaluateRsiReversionAtClose({
      barsAsc,
      targetCloseTimeIso: target,
      rsiPeriod: 3,
      oversold: 30,
    });
    expect(r.intent).toBe("ENTER");
  });

  it("emits EXIT when RSI crosses down through overbought", () => {
    // Up-down sequence so RSI was above 70 on prev bar and falls below on the
    // last bar. Use a small period for sensitivity.
    const barsAsc = [50, 60, 70, 80, 70].map((close, i) => ({
      close,
      closeTimeIso: new Date(Date.UTC(2026, 0, 2, 0, i * 15)).toISOString(),
    }));
    const target = barsAsc[barsAsc.length - 1].closeTimeIso;
    const r = evaluateRsiReversionAtClose({
      barsAsc,
      targetCloseTimeIso: target,
      rsiPeriod: 3,
      oversold: 30,
      overbought: 70,
    });
    expect(r.intent).toBe("EXIT");
  });
});
