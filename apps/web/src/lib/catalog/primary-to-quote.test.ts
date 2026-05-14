import { describe, expect, it } from "vitest";

import { primaryUnitsToQuoteUnits } from "./primary-to-quote";

describe("primaryUnitsToQuoteUnits", () => {
  it("identity USD→USD (both dollar_value=1) returns the same number", () => {
    const out = primaryUnitsToQuoteUnits({
      primaryAmount: 100,
      primaryDollarValue: 1,
      quoteDollarValue: 1,
    });
    expect(out).toBe(100);
  });

  it("USD primary → EUR quote (1 EUR = 1.10 USD): 100 USD → ~90.909 EUR", () => {
    const out = primaryUnitsToQuoteUnits({
      primaryAmount: 100,
      primaryDollarValue: 1,
      quoteDollarValue: 1.1,
    });
    expect(out).toBeCloseTo(100 / 1.1, 5);
  });

  it("EUR primary → USD quote (1 EUR = 1.10 USD): 100 EUR → 110 USD", () => {
    const out = primaryUnitsToQuoteUnits({
      primaryAmount: 100,
      primaryDollarValue: 1.1,
      quoteDollarValue: 1,
    });
    expect(out).toBeCloseTo(110, 5);
  });

  it("USD primary → USDT quote (1 USDT ~ 1 USD) returns ~same number", () => {
    const out = primaryUnitsToQuoteUnits({
      primaryAmount: 250,
      primaryDollarValue: 1,
      quoteDollarValue: 1.0001,
    });
    expect(out).toBeCloseTo(250 / 1.0001, 4);
  });

  it("returns null when primary dollar_value is missing", () => {
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: 100, primaryDollarValue: null, quoteDollarValue: 1 }),
    ).toBeNull();
  });

  it("returns null when quote dollar_value is missing", () => {
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: 100, primaryDollarValue: 1, quoteDollarValue: null }),
    ).toBeNull();
  });

  it("returns null when primary amount is zero or negative", () => {
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: 0, primaryDollarValue: 1, quoteDollarValue: 1 }),
    ).toBeNull();
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: -5, primaryDollarValue: 1, quoteDollarValue: 1 }),
    ).toBeNull();
  });

  it("returns null when primary dollar_value is non-positive", () => {
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: 100, primaryDollarValue: 0, quoteDollarValue: 1 }),
    ).toBeNull();
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: 100, primaryDollarValue: -1, quoteDollarValue: 1 }),
    ).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(
      primaryUnitsToQuoteUnits({ primaryAmount: NaN, primaryDollarValue: 1, quoteDollarValue: 1 }),
    ).toBeNull();
    expect(
      primaryUnitsToQuoteUnits({
        primaryAmount: Infinity,
        primaryDollarValue: 1,
        quoteDollarValue: 1,
      }),
    ).toBeNull();
  });
});
