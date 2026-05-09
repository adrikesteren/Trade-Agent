import { describe, expect, it } from "vitest";

import { executorPaperFeeEur, tradeBuyDebitEur } from "./executor-wallet";

describe("executorPaperFeeEur", () => {
  it("matches paper worker fee rounding (0.25% of notional)", () => {
    expect(executorPaperFeeEur(100)).toBe(0.25);
    expect(executorPaperFeeEur(10)).toBe(0.025);
  });
  it("returns 0 for non-positive notional", () => {
    expect(executorPaperFeeEur(0)).toBe(0);
    expect(executorPaperFeeEur(-1)).toBe(0);
  });
});

describe("tradeBuyDebitEur", () => {
  it("sums notional and fee", () => {
    expect(tradeBuyDebitEur(100, 0.25)).toBe(100.25);
  });
  it("treats non-finite parts as 0", () => {
    expect(tradeBuyDebitEur(Number.NaN, 1)).toBe(1);
    expect(tradeBuyDebitEur(10, Number.NaN)).toBe(10);
  });
});
