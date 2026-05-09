import { describe, expect, it } from "vitest";

import type { ExecutorRow } from "./executors";
import { defaultNotionalFromExecutor, executorToMediatorRails } from "./executor-mediator-rails";

const baseEx: ExecutorRow = {
  id: "e1",
  user_id: "u1",
  name: "Default",
  enabled: true,
  execution_mode: "paper",
  asset_filter_mode: "all",
  filter_asset_ids: [],
  default_notional_eur: 100,
  max_risk_per_trade: 0.05,
  max_open_positions: 5,
  max_exposure_per_symbol_eur: 500,
  daily_loss_limit_eur: 100,
  max_drawdown_eur: 500,
  cooldown_after_losses: 3,
  allow_add: false,
  mediator_rails_extra: {},
};

describe("executorToMediatorRails", () => {
  it("uses typed columns", () => {
    const r = executorToMediatorRails(baseEx);
    expect(r.maxRiskPerTrade).toBe(0.05);
    expect(r.maxOpenPositions).toBe(5);
    expect(r.allowAdd).toBe(false);
  });

  it("merges mediator_rails_extra overrides", () => {
    const r = executorToMediatorRails({
      ...baseEx,
      max_risk_per_trade: 0.05,
      mediator_rails_extra: { maxRiskPerTrade: 0.1, allowAdd: true },
    });
    expect(r.maxRiskPerTrade).toBe(0.1);
    expect(r.allowAdd).toBe(true);
  });
});

describe("defaultNotionalFromExecutor", () => {
  it("returns 100 for invalid", () => {
    expect(defaultNotionalFromExecutor({ ...baseEx, default_notional_eur: 0 })).toBe(100);
  });
});
