import { describe, expect, it } from "vitest";

import { aggregateReplayBarsToTimeframe, type ReplayBar } from "./aggregate-replay-bars";

function build15mBar(closeMs: number, close: number, opts?: { high?: number; low?: number; open?: number; volume?: number }): ReplayBar {
  return {
    open: opts?.open ?? close - 1,
    high: opts?.high ?? close + 0.5,
    low: opts?.low ?? close - 1.5,
    close,
    volume: opts?.volume ?? 1,
    closeTimeIso: new Date(closeMs).toISOString(),
  };
}

describe("aggregateReplayBarsToTimeframe", () => {
  it("returns empty for empty input", () => {
    expect(aggregateReplayBarsToTimeframe([], 1440)).toEqual([]);
  });

  it("rolls 96 × 15m bars into a single daily bar (open from first, close from last, summed volume)", () => {
    const dayStartMs = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
    const bars: ReplayBar[] = [];
    for (let i = 0; i < 96; i += 1) {
      const closeMs = dayStartMs + (i + 1) * 15 * 60_000;
      bars.push(build15mBar(closeMs, 100 + i, { open: 100 + i - 1, high: 100 + i + 2, low: 100 + i - 2, volume: 10 }));
    }
    const out = aggregateReplayBarsToTimeframe(bars, 1440);
    expect(out).toHaveLength(1);
    expect(out[0]!.open).toBe(99);
    expect(out[0]!.close).toBe(195);
    expect(out[0]!.volume).toBe(960);
    expect(out[0]!.closeTimeIso).toBe(new Date(dayStartMs + 24 * 60 * 60_000).toISOString());
    expect(out[0]!.high).toBeGreaterThanOrEqual(195 + 2);
    expect(out[0]!.low).toBeLessThanOrEqual(100 - 2);
  });

  it("rolls 16 × 15m bars into a single 4h bar with epoch-aligned open", () => {
    const startMs = Date.UTC(2026, 0, 1, 4, 0, 0); // 04:00 UTC — aligned 4h boundary
    const bars: ReplayBar[] = [];
    for (let i = 0; i < 16; i += 1) {
      const closeMs = startMs + (i + 1) * 15 * 60_000;
      bars.push(build15mBar(closeMs, 50 + i));
    }
    const out = aggregateReplayBarsToTimeframe(bars, 240);
    expect(out).toHaveLength(1);
    expect(out[0]!.closeTimeIso).toBe(new Date(startMs + 4 * 60 * 60_000).toISOString());
    expect(out[0]!.close).toBe(65);
  });

  it("splits 15m bars that straddle two daily buckets into two daily outputs", () => {
    const dayAOpenMs = Date.UTC(2026, 0, 1);
    const dayBOpenMs = Date.UTC(2026, 0, 2);
    const bars: ReplayBar[] = [
      build15mBar(dayAOpenMs + 23 * 60 * 60_000 + 45 * 60_000, 100, { volume: 5 }), // bar closing at 23:45 → still day A bucket (open=23:30)
      build15mBar(dayBOpenMs, 200, { volume: 7 }), // bar closing at 00:00 day B (open=23:45 day A) → also day A bucket
      build15mBar(dayBOpenMs + 15 * 60_000, 300, { volume: 11 }), // bar closing 00:15 day B (open=00:00 day B) → day B bucket
    ];
    const out = aggregateReplayBarsToTimeframe(bars, 1440);
    expect(out).toHaveLength(2);
    expect(out[0]!.closeTimeIso).toBe(new Date(dayBOpenMs).toISOString());
    expect(out[0]!.volume).toBe(12);
    expect(out[1]!.closeTimeIso).toBe(new Date(dayBOpenMs + 24 * 60 * 60_000).toISOString());
    expect(out[1]!.volume).toBe(11);
  });

  it("throws when target is not a multiple of source", () => {
    expect(() => aggregateReplayBarsToTimeframe([], 30, { sourceTfMinutes: 15 })).not.toThrow();
    expect(() => aggregateReplayBarsToTimeframe([], 17, { sourceTfMinutes: 15 })).toThrow(
      /must be a multiple/,
    );
  });
});
