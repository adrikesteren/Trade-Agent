import { describe, expect, it } from "vitest";

import type { ExecutorRow } from "./executors-lookup.service";
import { executorToMediatorRails } from "./executor-mediator-rails.service";

const baseEx: ExecutorRow = {
  id: "e1",
  user_id: "u1",
  exchange_id: "x1",
  name: "Default",
  enabled: true,
  execution_mode: "paper",
  asset_filter_mode: "all",
  filter_asset_ids: [],
  max_risk_per_trade: 0.05,
  max_open_positions: 5,
  max_exposure_per_symbol_eur: 500,
  daily_loss_limit_eur: 100,
  max_drawdown_eur: 500,
  cooldown_after_losses: 3,
  allow_add: false,
  profit_taking_enabled: false,
  moving_floor_trail_pct: 0.15,
  moving_floor_activation_profit_pct: 0.05,
  moving_floor_timeframe: "15m",
  mediator_rails_extra: {},
  slack_trade_notifications_enabled: true,
  exchange_api_key: "",
  exchange_api_secret: "",
};

describe("executorToMediatorRails", () => {
  it("uses typed columns", () => {
    const r = executorToMediatorRails(baseEx);
    expect(r.maxRiskPerTrade).toBe(0.05);
    expect(r.maxOpenPositions).toBe(5);
    expect(r.allowAdd).toBe(false);
    expect(r.profitTakingEnabled).toBe(false);
  });

  it("merges mediator_rails_extra overrides", () => {
    const r = executorToMediatorRails({
      ...baseEx,
      max_risk_per_trade: 0.05,
      mediator_rails_extra: { maxRiskPerTrade: 0.1, allowAdd: true, profitTakingEnabled: true },
    });
    expect(r.maxRiskPerTrade).toBe(0.1);
    expect(r.allowAdd).toBe(true);
    expect(r.profitTakingEnabled).toBe(true);
  });
});

