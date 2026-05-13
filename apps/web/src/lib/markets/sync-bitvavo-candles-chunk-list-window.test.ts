import { describe, expect, it, vi } from "vitest";

import type { Candle, ListCandlesParams } from "@repo/exchange";

import { listCandlesForWindow } from "./sync-bitvavo-candles-chunk";

const STEP_15M = 15 * 60 * 1000;

function makeCandle(openMs: number): Candle {
  return {
    exchange: "bitvavo",
    symbol: "BTC-EUR",
    timeframe: "15m",
    openTime: new Date(openMs).toISOString(),
    closeTime: new Date(openMs + STEP_15M).toISOString(),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
  };
}

describe("listCandlesForWindow", () => {
  it("uses aligned Bitvavo end for the second page (oldestOpen, not oldestOpen-1)", async () => {
    const endClose = 1_704_067_200_000;
    const oldestOpenPage1 = endClose - 1440 * STEP_15M;
    const calls: { endTime?: string; limit: number }[] = [];

    const adapter = {
      listCandles: vi.fn(async (params: ListCandlesParams) => {
        calls.push({ endTime: params.endTime, limit: params.limit ?? 0 });
        if (calls.length === 1) {
          expect(params.limit).toBe(1440);
          expect(params.endTime).toBe(String(endClose));
          const out: Candle[] = [];
          for (let o = oldestOpenPage1; o + STEP_15M <= endClose; o += STEP_15M) {
            out.push(makeCandle(o));
          }
          expect(out).toHaveLength(1440);
          return out;
        }
        expect(params.limit).toBe(560);
        expect(params.endTime).toBe(String(oldestOpenPage1));
        expect(params.endTime).not.toBe(String(oldestOpenPage1 - 1));
        const out: Candle[] = [];
        let start = oldestOpenPage1 - 560 * STEP_15M;
        for (let i = 0; i < 560; i++) {
          out.push(makeCandle(start));
          start += STEP_15M;
        }
        return out;
      }),
    };

    const merged = await listCandlesForWindow(adapter, {
      symbol: "BTC-EUR",
      timeframe: "15m",
      windowEndCloseMs: endClose,
      totalBars: 2000,
    });

    expect(merged).toHaveLength(2000);
    expect(calls).toHaveLength(2);
  });

  it("breaks when a follow-up page does not move oldestOpen backward", async () => {
    const endClose = 1_704_067_200_000;
    const sharedOldest = 1_000_000;
    let callN = 0;
    const adapter = {
      listCandles: vi.fn(async (params: ListCandlesParams) => {
        const limit = params.limit ?? 0;
        callN += 1;
        const out: Candle[] = [];
        for (let i = 0; i < limit; i++) {
          out.push(makeCandle(sharedOldest + i * STEP_15M));
        }
        return out;
      }),
    };

    const out = await listCandlesForWindow(adapter, {
      symbol: "X",
      timeframe: "15m",
      windowEndCloseMs: endClose,
      totalBars: 3000,
    });

    expect(out).toHaveLength(1440);
    expect(callN).toBe(2);
  });
});
