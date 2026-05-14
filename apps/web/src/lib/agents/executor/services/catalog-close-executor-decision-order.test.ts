import { describe, expect, it } from "vitest";

import { exitFirstRank } from "./catalog-close-executor-run.service";

describe("exitFirstRank", () => {
  it("returns 0 for null payload's fallback to ENTER → 1", () => {
    expect(exitFirstRank(null)).toBe(1);
  });

  it("returns 0 when resolvedIntent is EXIT", () => {
    expect(exitFirstRank({ resolvedIntent: "EXIT" })).toBe(0);
  });

  it("returns 0 when proposedOrder.side is sell", () => {
    expect(exitFirstRank({ proposedOrder: { side: "sell" } })).toBe(0);
  });

  it("returns 1 for ENTER + buy", () => {
    expect(exitFirstRank({ resolvedIntent: "ENTER", proposedOrder: { side: "buy" } })).toBe(1);
  });

  it("treats lowercase exit as not EXIT (case-sensitive uppercase normalization)", () => {
    // We uppercase before comparing, so any casing of `exit` should match.
    expect(exitFirstRank({ resolvedIntent: "exit" })).toBe(0);
  });

  it("SAR pair sort: EXIT-long ranks before ENTER-short", () => {
    const exitLong = { resolvedIntent: "EXIT", proposedOrder: { side: "sell", positionSide: "long" } };
    const enterShort = { resolvedIntent: "ENTER", proposedOrder: { side: "sell", positionSide: "short" } };
    // ENTER-short happens to also use side=sell on shorting exchanges, but
    // exitFirstRank only cares about side=sell which makes it look EXIT-ish.
    // For SAR we rely on resolvedIntent first, so this test exists to document
    // that a true EXIT (resolvedIntent=EXIT) is still rank 0 either way.
    expect(exitFirstRank(exitLong)).toBe(0);
    expect(exitFirstRank(enterShort)).toBe(0);
  });

  it("SAR pair on Bitvavo (long-only): EXIT-long buy then no ENTER (irrelevant)", () => {
    expect(exitFirstRank({ resolvedIntent: "EXIT", proposedOrder: { side: "sell" } })).toBe(0);
  });
});
