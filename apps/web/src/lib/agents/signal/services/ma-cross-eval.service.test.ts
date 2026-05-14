import { describe, expect, it } from "vitest";
import { evaluateMaCrossAtClose } from "./ma-cross-eval.service";

function ascBarsFromCloses(closes: number[], startMs: number, stepMs: number): { close: number; closeTimeIso: string }[] {
  return closes.map((close, i) => ({
    close,
    closeTimeIso: new Date(startMs + i * stepMs).toISOString(),
  }));
}

describe("evaluateMaCrossAtClose", () => {
  it("returns HOLD when target bar is missing", () => {
    const bars = ascBarsFromCloses([1, 2, 3], Date.UTC(2026, 0, 1, 12, 0, 0), 900_000);
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: new Date(Date.UTC(2026, 0, 1, 99, 0, 0)).toISOString(),
      fastPeriod: 2,
      slowPeriod: 3,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.reasons[0]).toMatch(/target_bar/);
  });

  it("returns HOLD when not enough bars for slow MA", () => {
    const bars = ascBarsFromCloses([1, 2, 3, 4], Date.UTC(2026, 0, 1, 12, 0, 0), 900_000);
    const target = bars[bars.length - 1]!.closeTimeIso;
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: target,
      fastPeriod: 2,
      slowPeriod: 5,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.reasons[0]).toBe("insufficient_bars");
  });

  it("detects bullish cross → ENTER", () => {
    // Flat then jump on last close so fast(2) crosses above slow(3) on the final bar.
    const closes = [100, 100, 100, 100, 100, 120];
    const bars = ascBarsFromCloses(closes, Date.UTC(2026, 0, 1, 10, 0, 0), 900_000);
    const target = bars[bars.length - 1]!.closeTimeIso;
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: target,
      fastPeriod: 2,
      slowPeriod: 3,
    });
    expect(r.intent).toBe("ENTER");
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.reasons[0]).toContain("ma_cross_up");
  });

  it("returns HOLD when MAs stay stacked bearishly", () => {
    const closes = [10, 9, 8, 7, 6, 5];
    const bars = ascBarsFromCloses(closes, Date.UTC(2026, 0, 2, 10, 0, 0), 900_000);
    const target = bars[bars.length - 1]!.closeTimeIso;
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: target,
      fastPeriod: 2,
      slowPeriod: 3,
    });
    expect(r.intent).toBe("HOLD");
  });

  it("emits EXIT on a confirmed bearish cross (fast MA crosses below slow MA)", () => {
    // Up then sharp drop so fast(2) was above slow(3) on prev bar and crosses below on the last bar.
    const closes = [100, 100, 100, 110, 120, 80];
    const bars = ascBarsFromCloses(closes, Date.UTC(2026, 0, 3, 10, 0, 0), 900_000);
    const target = bars[bars.length - 1]!.closeTimeIso;
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: target,
      fastPeriod: 2,
      slowPeriod: 3,
    });
    expect(r.intent).toBe("EXIT");
    expect(r.reasons[0]).toContain("ma_cross_down");
  });

  it("blocks ENTER under low volatility when minAtrPct gate is set", () => {
    // Bullish cross with tiny price moves so ATR% stays well below the gate.
    // ATR includes the gap |high-prevClose|, so we need very small moves
    // overall (no jumps) for atrPct to stay under 0.02.
    const closes = [100, 100, 100, 100, 100, 100.001];
    const bars = closes.map((close, i) => ({
      close,
      high: close + 0.0005,
      low: close - 0.0005,
      closeTimeIso: new Date(Date.UTC(2026, 0, 4, 10, 0, 0) + i * 900_000).toISOString(),
    }));
    const target = bars[bars.length - 1]!.closeTimeIso;
    const r = evaluateMaCrossAtClose({
      barsAsc: bars,
      targetCloseTimeIso: target,
      fastPeriod: 2,
      slowPeriod: 3,
      minAtrPct: 0.02,
      atrPeriod: 3,
    });
    expect(r.intent).toBe("HOLD");
    expect((r.reasons[0] ?? "").toLowerCase()).toContain("vol");
  });
});
