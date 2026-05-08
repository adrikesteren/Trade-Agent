import { describe, expect, it } from "vitest";
import { evaluateNewEntry } from "./evaluate";
import type { RiskRailsConfig, RiskStateSnapshot } from "./types";

const baseConfig: RiskRailsConfig = {
  maxRiskPerTrade: 0.05,
  maxOpenPositions: 5,
  maxExposurePerSymbolEur: 500,
  dailyLossLimitEur: 100,
  maxDrawdownEur: 500,
  cooldownAfterLosses: 3,
};

const healthyState: RiskStateSnapshot = {
  equityEur: 10_000,
  openPositionCount: 1,
  exposureBySymbolEur: { "BTC-EUR": 200 },
  dailyPnlEur: 0,
  maxDrawdownEur: 0,
  consecutiveLosses: 0,
  killSwitch: false,
};

describe("evaluateNewEntry", () => {
  it("allows a small buy within rails", () => {
    const r = evaluateNewEntry(
      baseConfig,
      healthyState,
      { symbol: "ETH-EUR", side: "buy", notionalEur: 100 },
    );
    expect(r.allowed).toBe(true);
    expect(r.reasonCodes).toEqual([]);
  });

  it("denies when kill switch is on", () => {
    const r = evaluateNewEntry(
      baseConfig,
      { ...healthyState, killSwitch: true },
      { symbol: "ETH-EUR", side: "buy", notionalEur: 50 },
    );
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("kill_switch");
  });

  it("denies when daily loss limit hit", () => {
    const r = evaluateNewEntry(
      baseConfig,
      { ...healthyState, dailyPnlEur: -150 },
      { symbol: "ETH-EUR", side: "buy", notionalEur: 50 },
    );
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("daily_loss_limit");
  });

  it("denies when per-trade risk too high", () => {
    const r = evaluateNewEntry(
      baseConfig,
      healthyState,
      { symbol: "ETH-EUR", side: "buy", notionalEur: 10_000 },
    );
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("max_risk_per_trade");
  });
});
