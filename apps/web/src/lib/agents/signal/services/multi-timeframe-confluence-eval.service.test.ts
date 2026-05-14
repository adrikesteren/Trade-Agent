import { describe, expect, it } from "vitest";

import {
  evaluateMultiTfConfluenceAtClose,
  type MultiTfBar,
} from "./multi-timeframe-confluence-eval.service";

/**
 * Build entry bars at 1-minute steps (timing only matters for ordering /
 * containment, not for the numeric eval) so the trend covering-bar lookup
 * always points at the latest trend bar.
 */
function buildEntryBars(closes: number[]): MultiTfBar[] {
  return closes.map((c, i) => ({
    close: c,
    closeTimeIso: new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toISOString(),
  }));
}

/**
 * Build trend bars all stamped at the same epoch (start of 2025) so they all
 * sit before any entry bar from 2026 — guaranteeing the covering-bar index
 * is the last trend bar.
 */
function buildTrendBars(closes: number[]): MultiTfBar[] {
  return closes.map((c, i) => ({
    close: c,
    closeTimeIso: new Date(Date.UTC(2025, 11, 1, 0, i, 0)).toISOString(),
  }));
}

describe("evaluateMultiTfConfluenceAtClose", () => {
  it("ENTERs when trend is up AND entry RSI crosses above threshold", () => {
    // 30 entry bars where RSI clearly crosses up through 30 at the last bar:
    // first many down then a strong up tick at the end.
    const entryCloses: number[] = [];
    for (let i = 0; i < 25; i += 1) entryCloses.push(100 - i * 2);
    entryCloses.push(50, 50, 51, 60); // sharp recovery — RSI surges above 30.
    const entryBars = buildEntryBars(entryCloses);

    // Trend up with MA10 < trendClose.
    const trendCloses = Array.from({ length: 30 }, (_, i) => 100 + i);
    const trendBars = buildTrendBars(trendCloses);

    const r = evaluateMultiTfConfluenceAtClose({
      trendBarsAsc: trendBars,
      entryBarsAsc: entryBars,
      targetCloseTimeIso: entryBars[entryBars.length - 1].closeTimeIso,
      trendMa: 10,
      entryRsiPeriod: 14,
      entryRsi: 30,
    });

    expect(r.intent).toBe("ENTER");
    expect(r.signalSide).toBe("long");
    expect(r.confidence).not.toBeNull();
  });

  it("HOLDs when trend is down even if entry RSI would cross", () => {
    const entryCloses: number[] = [];
    for (let i = 0; i < 25; i += 1) entryCloses.push(100 - i * 2);
    entryCloses.push(50, 50, 51, 60);
    const entryBars = buildEntryBars(entryCloses);

    // Trend bars: clearly down → trendClose < MA.
    const trendCloses = Array.from({ length: 30 }, (_, i) => 100 - i);
    const trendBars = buildTrendBars(trendCloses);

    const r = evaluateMultiTfConfluenceAtClose({
      trendBarsAsc: trendBars,
      entryBarsAsc: entryBars,
      targetCloseTimeIso: entryBars[entryBars.length - 1].closeTimeIso,
      trendMa: 10,
      entryRsiPeriod: 14,
      entryRsi: 30,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.signalSide).toBe("long");
    expect((r.reasons[0] ?? "").startsWith("no_confluence")).toBe(true);
  });

  it("HOLDs with insufficient trend bars", () => {
    const entryBars = buildEntryBars(Array.from({ length: 60 }, (_, i) => 100 + i));
    const trendBars = buildTrendBars([100, 101, 102]);
    const r = evaluateMultiTfConfluenceAtClose({
      trendBarsAsc: trendBars,
      entryBarsAsc: entryBars,
      targetCloseTimeIso: entryBars[entryBars.length - 1].closeTimeIso,
      trendMa: 50,
      entryRsiPeriod: 14,
      entryRsi: 30,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.reasons[0]).toBe("insufficient_trend_bars");
  });

  it("HOLDs when target bar is missing from entry series", () => {
    const entryBars = buildEntryBars(Array.from({ length: 30 }, (_, i) => 100 + i));
    const trendBars = buildTrendBars(Array.from({ length: 30 }, (_, i) => 100 + i * 0.2));
    const r = evaluateMultiTfConfluenceAtClose({
      trendBarsAsc: trendBars,
      entryBarsAsc: entryBars,
      targetCloseTimeIso: "2099-01-01T00:00:00.000Z",
      trendMa: 10,
      entryRsiPeriod: 14,
      entryRsi: 30,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.reasons[0]).toBe("target_bar_not_in_entry_series");
  });

  it("rejects invalid params", () => {
    const r = evaluateMultiTfConfluenceAtClose({
      trendBarsAsc: [],
      entryBarsAsc: [],
      targetCloseTimeIso: new Date().toISOString(),
      trendMa: 1,
      entryRsiPeriod: 14,
      entryRsi: 30,
    });
    expect(r.intent).toBe("HOLD");
    expect(r.reasons[0]).toBe("invalid_params");
  });
});
