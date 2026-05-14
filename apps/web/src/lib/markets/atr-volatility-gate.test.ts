import { describe, expect, it } from "vitest";

import { passesVolatilityGate } from "./atr-volatility-gate";

describe("passesVolatilityGate", () => {
  it("passes when no bounds are configured and inputs are finite", () => {
    const r = passesVolatilityGate({ atr: 2, price: 100 });
    expect(r.pass).toBe(true);
    expect(r.atrPct).toBeCloseTo(0.02);
    expect(r.reason).toBe("");
  });

  it("rejects non-finite or non-positive inputs", () => {
    expect(passesVolatilityGate({ atr: Number.NaN, price: 100 }).reason).toBe("invalid_inputs");
    expect(passesVolatilityGate({ atr: 1, price: 0 }).reason).toBe("invalid_inputs");
    expect(passesVolatilityGate({ atr: 1, price: -10 }).reason).toBe("invalid_inputs");
  });

  it("rejects when ATR%% is below minAtrPct (low volatility / chop)", () => {
    const r = passesVolatilityGate({ atr: 0.05, price: 100, minAtrPct: 0.002 });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("low_volatility");
    expect(r.atrPct).toBeCloseTo(0.0005);
  });

  it("rejects when ATR%% is above maxAtrPct (panic / wild markets)", () => {
    const r = passesVolatilityGate({ atr: 15, price: 100, maxAtrPct: 0.1 });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("high_volatility");
    expect(r.atrPct).toBeCloseTo(0.15);
  });

  it("passes when ATR%% sits exactly on the lower or upper bound (inclusive)", () => {
    expect(passesVolatilityGate({ atr: 1, price: 100, minAtrPct: 0.01 }).pass).toBe(true);
    expect(passesVolatilityGate({ atr: 10, price: 100, maxAtrPct: 0.1 }).pass).toBe(true);
  });

  it("ignores nullish bounds (treated as not-configured)", () => {
    const r = passesVolatilityGate({ atr: 5, price: 100, minAtrPct: null, maxAtrPct: null });
    expect(r.pass).toBe(true);
  });

  it("respects both bounds simultaneously", () => {
    const cfg = { minAtrPct: 0.005, maxAtrPct: 0.05 };
    expect(passesVolatilityGate({ atr: 0.4, price: 100, ...cfg }).reason).toBe("low_volatility");
    expect(passesVolatilityGate({ atr: 6, price: 100, ...cfg }).reason).toBe("high_volatility");
    expect(passesVolatilityGate({ atr: 2, price: 100, ...cfg }).pass).toBe(true);
  });
});
