import { describe, expect, it } from "vitest";
import { baseQuantityFromNotionalEur, mergeBuyPositionAvg } from "./paper-fill";

describe("baseQuantityFromNotionalEur", () => {
  it("computes quantity", () => {
    expect(baseQuantityFromNotionalEur(100, 200)).toBe(0.5);
  });
  it("returns 0 for bad inputs", () => {
    expect(baseQuantityFromNotionalEur(0, 200)).toBe(0);
    expect(baseQuantityFromNotionalEur(100, 0)).toBe(0);
  });
});

describe("mergeBuyPositionAvg", () => {
  it("sets avg to add price when flat", () => {
    const r = mergeBuyPositionAvg({ existingQty: 0, existingAvg: null, addQty: 1, addPrice: 100 });
    expect(r.quantity).toBe(1);
    expect(r.avgPrice).toBe(100);
  });
  it("merges weighted average", () => {
    const r = mergeBuyPositionAvg({ existingQty: 1, existingAvg: 100, addQty: 1, addPrice: 200 });
    expect(r.quantity).toBe(2);
    expect(r.avgPrice).toBe(150);
  });
});
