import { describe, expect, it } from "vitest";

import { computeHistoricalCandleWindow } from "./historical-candle-window.service";

describe("computeHistoricalCandleWindow", () => {
  it("returns empty when start is after end", () => {
    const r = computeHistoricalCandleWindow({
      startDate: "2024-02-01",
      endDate: "2024-01-01",
      timeframe: "15m",
    });
    expect(r.kind).toBe("empty");
    if (r.kind === "empty") expect(r.reason).toBe("start_date_after_end_date");
  });

  it("returns a consistent 15m bar count for a single UTC calendar day (epoch grid)", () => {
    const r = computeHistoricalCandleWindow({
      startDate: "2024-06-10",
      endDate: "2024-06-10",
      timeframe: "15m",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.barCount).toBeGreaterThan(90);
      expect(r.barCount).toBeLessThanOrEqual(96);
      expect(r.barCount).toBe(95);
    }
  });

  it("returns a consistent 15m bar count across two inclusive UTC days (epoch grid)", () => {
    const r = computeHistoricalCandleWindow({
      startDate: "2024-06-10",
      endDate: "2024-06-11",
      timeframe: "15m",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.barCount).toBe(191);
      expect(r.ingestStartOpenMs).toBe(r.startOpenMs);
      expect(r.ingestBarCount).toBe(r.barCount);
    }
  });

  it("expands the ingest window backwards by `extraWarmupMs` without growing the replay barCount", () => {
    const stepMs = 15 * 60_000;
    const warmupBars = 96; // one day on 15m
    const r = computeHistoricalCandleWindow({
      startDate: "2024-06-10",
      endDate: "2024-06-11",
      timeframe: "15m",
      extraWarmupMs: warmupBars * stepMs,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      // Replay window stays the same — bars_total in the orchestrator must NOT include warmup.
      expect(r.barCount).toBe(191);
      expect(r.ingestStartOpenMs).toBe(r.startOpenMs - warmupBars * stepMs);
      expect(r.ingestBarCount).toBe(191 + warmupBars);
    }
  });
});
