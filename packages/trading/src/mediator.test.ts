import { describe, expect, it } from "vitest";
import { runMediator } from "./mediator";
import type { RiskRailsConfig, RiskStateSnapshot } from "@repo/risk";

const rails: RiskRailsConfig = {
  maxRiskPerTrade: 0.05,
  maxOpenPositions: 5,
  maxExposurePerSymbolEur: 500,
  dailyLossLimitEur: 100,
  maxDrawdownEur: 500,
  cooldownAfterLosses: 3,
};

const risk: RiskStateSnapshot = {
  equityEur: 10_000,
  openPositionCount: 0,
  exposureBySymbolEur: {},
  dailyPnlEur: 0,
  maxDrawdownEur: 0,
  consecutiveLosses: 0,
  killSwitch: false,
};

describe("runMediator", () => {
  it("denies hold signals", () => {
    const d = runMediator({
      rails,
      risk,
      signal: {
        agentId: "t",
        symbol: "BTC-EUR",
        action: "hold",
        confidence: 0.5,
      },
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("hold_signal");
  });

  it("approves buy when rails pass", () => {
    const d = runMediator({
      rails,
      risk,
      signal: {
        agentId: "t",
        symbol: "BTC-EUR",
        action: "buy",
        confidence: 0.8,
        notionalEur: 50,
      },
    });
    expect(d.approved).toBe(true);
    expect(d.proposed?.side).toBe("buy");
  });
});
