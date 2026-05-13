import { describe, expect, it } from "vitest";

import { valueInPrimaryUnits } from "./asset-dollar-value";

describe("valueInPrimaryUnits", () => {
  it("uses divide-by-1 when primary is USD", () => {
    expect(
      valueInPrimaryUnits({
        quantity: 2,
        fromDollarValue: 50_000,
        primaryDollarValue: 1,
        primaryAssetCode: "USD",
      }),
    ).toBe(100_000);
  });

  it("converts USD notional to EUR via primary dollar value", () => {
    expect(
      valueInPrimaryUnits({
        quantity: 1,
        fromDollarValue: 100,
        primaryDollarValue: 1.1,
        primaryAssetCode: "EUR",
      }),
    ).toBeCloseTo(100 / 1.1, 5);
  });

  it("returns null when from dollar value missing", () => {
    expect(
      valueInPrimaryUnits({
        quantity: 1,
        fromDollarValue: null,
        primaryDollarValue: 1,
        primaryAssetCode: "USD",
      }),
    ).toBeNull();
  });

  it("returns null when primary non-USD and primary dollar value missing", () => {
    expect(
      valueInPrimaryUnits({
        quantity: 1,
        fromDollarValue: 100,
        primaryDollarValue: null,
        primaryAssetCode: "EUR",
      }),
    ).toBeNull();
  });

  it("returns null for non-finite quantity", () => {
    expect(
      valueInPrimaryUnits({
        quantity: Number.NaN,
        fromDollarValue: 1,
        primaryDollarValue: 1,
        primaryAssetCode: "USD",
      }),
    ).toBeNull();
  });
});
