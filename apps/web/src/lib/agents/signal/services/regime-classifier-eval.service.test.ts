import { describe, expect, it } from "vitest";

import { evaluateRegimeAtClose, type RegimeClassifierBar } from "./regime-classifier-eval.service";

function bar(close: number, dayOffset: number): RegimeClassifierBar {
  const t = new Date(2026, 0, 1 + dayOffset).toISOString();
  return { close, closeTimeIso: t };
}

function constantBars(close: number, n: number): RegimeClassifierBar[] {
  return Array.from({ length: n }, (_, i) => bar(close, i));
}

function risingBars(start: number, step: number, n: number): RegimeClassifierBar[] {
  return Array.from({ length: n }, (_, i) => bar(start + i * step, i));
}

function fallingBars(start: number, step: number, n: number): RegimeClassifierBar[] {
  return Array.from({ length: n }, (_, i) => bar(start - i * step, i));
}

describe("evaluateRegimeAtClose", () => {
  it("returns sideways with intent=HOLD when params are invalid", () => {
    const r = evaluateRegimeAtClose({
      barsAsc: constantBars(100, 250),
      targetCloseTimeIso: bar(100, 249).closeTimeIso,
      maPeriod: 1,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("sideways");
    expect(r.reasons[0]).toBe("invalid_params");
  });

  it("returns sideways for a flat / constant price series", () => {
    const r = evaluateRegimeAtClose({
      barsAsc: constantBars(100, 250),
      targetCloseTimeIso: bar(100, 249).closeTimeIso,
      maPeriod: 200,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("sideways");
    expect(r.signalSide).toBe("long");
    expect(r.confidence).toBeNull();
  });

  it("returns bull on a steady uptrend with price > MA200", () => {
    // 250 daily bars from 100 → 100 + 250*0.5 = 225. By bar 250 the 200-MA
    // sits well below price and the slope is clearly positive.
    const r = evaluateRegimeAtClose({
      barsAsc: risingBars(100, 0.5, 250),
      targetCloseTimeIso: bar(100 + 249 * 0.5, 249).closeTimeIso,
      maPeriod: 200,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("bull");
    expect(r.signalSide).toBe("long");
    expect(r.confidence).not.toBeNull();
  });

  it("returns bear on a steady downtrend with price < MA200", () => {
    const r = evaluateRegimeAtClose({
      barsAsc: fallingBars(225, 0.5, 250),
      targetCloseTimeIso: bar(225 - 249 * 0.5, 249).closeTimeIso,
      maPeriod: 200,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("bear");
    expect(r.signalSide).toBe("short");
    expect(r.confidence).not.toBeNull();
  });

  it("returns sideways when there are insufficient bars for the MA period", () => {
    const r = evaluateRegimeAtClose({
      barsAsc: risingBars(100, 0.5, 10),
      targetCloseTimeIso: bar(100 + 9 * 0.5, 9).closeTimeIso,
      maPeriod: 200,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("sideways");
    expect(r.reasons[0]).toBe("insufficient_bars");
  });

  it("returns sideways when target bar is not present in series", () => {
    const r = evaluateRegimeAtClose({
      barsAsc: risingBars(100, 0.5, 250),
      targetCloseTimeIso: "2099-09-09T00:00:00.000Z",
      maPeriod: 200,
      slopeBars: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.metadata.regime).toBe("sideways");
    expect(r.reasons[0]).toBe("target_bar_not_in_series");
  });
});
