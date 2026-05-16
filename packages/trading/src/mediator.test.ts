import { describe, expect, it } from "vitest";
import { aggregateSignalIntents, evaluateTradeDecision, type MediatorRailsConfig } from "./mediator";
import type { RiskStateSnapshot } from "@repo/risk";

const rails: MediatorRailsConfig = {
  maxRiskPerTrade: 0.05,
  maxOpenPositions: 5,
  dailyLossLimitEur: 100,
  maxDrawdownEur: 500,
  cooldownAfterLosses: 3,
  allowAdd: false,
};

const risk: RiskStateSnapshot = {
  equityEur: 10_000,
  openPositionCount: 0,
  dailyPnlEur: 0,
  maxDrawdownEur: 0,
  consecutiveLosses: 0,
  killSwitch: false,
};

describe("aggregateSignalIntents", () => {
  it("prefers EXIT over ENTER", () => {
    expect(aggregateSignalIntents(["ENTER", "HOLD", "EXIT"])).toBe("EXIT");
  });
  it("prefers REDUCE over ENTER", () => {
    expect(aggregateSignalIntents(["ENTER", "REDUCE"])).toBe("REDUCE");
  });
  it("prefers ADD over ENTER", () => {
    expect(aggregateSignalIntents(["ENTER", "ADD"])).toBe("ADD");
  });
  it("returns HOLD when empty", () => {
    expect(aggregateSignalIntents([])).toBe("HOLD");
  });
});

describe("evaluateTradeDecision", () => {
  it("denies when there are no signal intents", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: [],
      inPosition: false,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("no_signals");
    expect(d.resolvedIntent).toBe("HOLD");
  });

  it("denies HOLD aggregate", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["HOLD", "HOLD"],
      inPosition: false,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("hold_intent");
    expect(d.resolvedIntent).toBe("HOLD");
  });

  it("approves ENTER when flat and rails pass", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["ENTER"],
      inPosition: false,
      notionalEurSuggested: 50,
    });
    expect(d.approved).toBe(true);
    expect(d.proposedOrder?.side).toBe("buy");
    expect(d.resolvedIntent).toBe("ENTER");
  });

  it("denies ENTER when already in position", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["ENTER"],
      inPosition: true,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("already_in_position");
  });

  it("allows ENTER while in position when enterScaleInWhenLong (historical replay scale-in)", () => {
    const d = evaluateTradeDecision({
      rails,
      risk: {
        ...risk,
        openPositionCount: 1,
      },
      marketSymbol: "BTC-EUR",
      signalIntents: ["ENTER"],
      inPosition: true,
      enterScaleInWhenLong: true,
      notionalEurSuggested: 50,
    });
    expect(d.approved).toBe(true);
    expect(d.reasonCodes).toEqual([]);
    expect(d.proposedOrder?.side).toBe("buy");
  });

  it("denies ADD by default when in position", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "ETH-EUR",
      signalIntents: ["ADD"],
      inPosition: true,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("add_not_enabled");
  });

  it("allows ADD when allowAdd and rails pass", () => {
    const d = evaluateTradeDecision({
      rails: { ...rails, allowAdd: true },
      risk: { ...risk, openPositionCount: 1 },
      marketSymbol: "ETH-EUR",
      signalIntents: ["ADD"],
      inPosition: true,
      notionalEurSuggested: 50,
    });
    expect(d.approved).toBe(true);
    expect(d.proposedOrder?.side).toBe("buy");
    expect(d.resolvedIntent).toBe("ADD");
  });

  it("denies EXIT without position", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["EXIT"],
      inPosition: false,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("no_position");
  });

  it("approves EXIT with position as sell proposal", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["EXIT"],
      inPosition: true,
      positionQuantity: 2,
      marketPriceEur: 100,
    });
    expect(d.approved).toBe(true);
    expect(d.proposedOrder?.side).toBe("sell");
    expect(d.proposedOrder?.notionalEur).toBe(200);
  });

  it("denies REDUCE with position until executor exists", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: ["REDUCE"],
      inPosition: true,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("reduce_not_implemented");
  });

  it("respects kill switch on ENTER", () => {
    const d = evaluateTradeDecision({
      rails,
      risk: { ...risk, killSwitch: true },
      marketSymbol: "BTC-EUR",
      signalIntents: ["ENTER"],
      inPosition: false,
      notionalEurSuggested: 50,
    });
    expect(d.approved).toBe(false);
    expect(d.reasonCodes).toContain("kill_switch");
  });

  it("approves forced EXIT without signals", () => {
    const d = evaluateTradeDecision({
      rails,
      risk,
      marketSymbol: "BTC-EUR",
      signalIntents: [],
      inPosition: true,
      forceExit: true,
      positionQuantity: 1,
      marketPriceEur: 120,
    });
    expect(d.approved).toBe(true);
    expect(d.resolvedIntent).toBe("EXIT");
    expect(d.reasonCodes).toContain("moving_floor_triggered");
    expect(d.proposedOrder?.side).toBe("sell");
  });
});
