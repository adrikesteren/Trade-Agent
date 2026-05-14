import { describe, expect, it, vi } from "vitest";

import { fetchExecutorQuoteBudgetInQuoteUnits } from "./executor-quote-budget.service";

type MockBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function makeBuilder(result: { data: unknown; error: unknown }): MockBuilder {
  const b: Partial<MockBuilder> = {};
  b.select = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockReturnValue(b);
  b.in = vi.fn().mockReturnValue(b);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  return b as MockBuilder;
}

function makeListBuilder(result: { data: unknown; error: unknown }): MockBuilder {
  const b: Partial<MockBuilder> = {};
  b.select = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockReturnValue(b);
  b.in = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  return b as MockBuilder;
}

type Schema = { from: ReturnType<typeof vi.fn> };
type Admin = {
  schema: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function makeAdmin({
  budget,
  pref,
  assets,
}: {
  budget: { data: unknown; error: unknown };
  pref: { data: unknown; error: unknown };
  assets: { data: unknown; error: unknown };
}): Admin {
  const tradingFrom = vi.fn().mockReturnValue(makeBuilder(budget));
  const catalogFrom = vi.fn().mockReturnValue(makeListBuilder(assets));
  const tradingSchema: Schema = { from: tradingFrom };
  const catalogSchema: Schema = { from: catalogFrom };
  const schema = vi.fn().mockImplementation((name: string) => {
    if (name === "trading") return tradingSchema;
    if (name === "catalog") return catalogSchema;
    throw new Error(`unexpected schema ${name}`);
  });
  const fromPublic = vi.fn().mockReturnValue(makeBuilder(pref));
  return {
    schema,
    from: fromPublic,
  };
}

describe("fetchExecutorQuoteBudgetInQuoteUnits", () => {
  it("returns null when no junction row exists", async () => {
    const admin = makeAdmin({
      budget: { data: null, error: null },
      pref: { data: { primary_asset_id: "U" }, error: null },
      assets: { data: [], error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchExecutorQuoteBudgetInQuoteUnits(admin as any, {
      executorId: "e1",
      quoteAssetId: "EUR",
    });
    expect(out).toBeNull();
  });

  it("returns null when max_notional_primary is non-positive", async () => {
    const admin = makeAdmin({
      budget: {
        data: {
          max_notional_primary: 0,
          executor_id: "e1",
          quote_asset_id: "EUR",
          executors: { user_id: "u1" },
        },
        error: null,
      },
      pref: { data: { primary_asset_id: "U" }, error: null },
      assets: { data: [], error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchExecutorQuoteBudgetInQuoteUnits(admin as any, {
      executorId: "e1",
      quoteAssetId: "EUR",
    });
    expect(out).toBeNull();
  });

  it("returns max_notional_primary unchanged when primary asset == quote asset", async () => {
    const admin = makeAdmin({
      budget: {
        data: {
          max_notional_primary: 250,
          executor_id: "e1",
          quote_asset_id: "EUR",
          executors: { user_id: "u1" },
        },
        error: null,
      },
      pref: { data: { primary_asset_id: "EUR" }, error: null },
      assets: { data: [], error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchExecutorQuoteBudgetInQuoteUnits(admin as any, {
      executorId: "e1",
      quoteAssetId: "EUR",
    });
    expect(out).toBe(250);
  });

  it("converts USD primary → EUR quote: 100 USD → ~90.909 EUR (1 EUR = 1.10 USD)", async () => {
    const admin = makeAdmin({
      budget: {
        data: {
          max_notional_primary: 100,
          executor_id: "e1",
          quote_asset_id: "EUR",
          executors: { user_id: "u1" },
        },
        error: null,
      },
      pref: { data: { primary_asset_id: "USD" }, error: null },
      assets: {
        data: [
          { id: "USD", dollar_value: 1 },
          { id: "EUR", dollar_value: 1.1 },
        ],
        error: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchExecutorQuoteBudgetInQuoteUnits(admin as any, {
      executorId: "e1",
      quoteAssetId: "EUR",
    });
    expect(out).not.toBeNull();
    expect(out!).toBeCloseTo(100 / 1.1, 5);
  });

  it("returns null when dollar_value missing for the quote asset", async () => {
    const admin = makeAdmin({
      budget: {
        data: {
          max_notional_primary: 100,
          executor_id: "e1",
          quote_asset_id: "EUR",
          executors: { user_id: "u1" },
        },
        error: null,
      },
      pref: { data: { primary_asset_id: "USD" }, error: null },
      assets: {
        data: [
          { id: "USD", dollar_value: 1 },
          { id: "EUR", dollar_value: null },
        ],
        error: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchExecutorQuoteBudgetInQuoteUnits(admin as any, {
      executorId: "e1",
      quoteAssetId: "EUR",
    });
    expect(out).toBeNull();
  });
});
