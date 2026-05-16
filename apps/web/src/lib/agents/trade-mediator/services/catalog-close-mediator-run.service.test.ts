import { describe, expect, it } from "vitest";

import { buildQuoteAssetNotAllowedSkipDecision } from "./catalog-close-mediator-run.service";

const baseArgs = {
  ownerId: "user-1",
  executor: { id: "exec-1", name: "Default", exchange_id: "exch-bitvavo" },
  timeframe: "15m",
  candleId: "candle-1",
  primarySignalId: "sig-1",
  matched: [
    { id: "sig-1", intent: "ENTER", agent_slug: "ma-cross" },
    { id: "sig-2", intent: "ENTER", agent_slug: "rsi-oversold" },
  ],
  marketSymbol: "GIGA-EUR",
  quoteAssetIdForMarket: "asset-eur",
  closeTimeIso: "2026-05-14T17:00:00Z",
  riskSnap: {
    equityEur: 0,
    openPositionCount: 0,
    exposureBySymbolEur: {},
    dailyPnlEur: 0,
    maxDrawdownEur: 0,
    consecutiveLosses: 0,
    killSwitch: false,
  },
};

describe("buildQuoteAssetNotAllowedSkipDecision", () => {
  it("emits approved=false with reason quote_asset_not_allowed and no proposedOrder", () => {
    const row = buildQuoteAssetNotAllowedSkipDecision(baseArgs);
    expect(row.approved).toBe(false);
    expect(row.reason_codes).toEqual(["quote_asset_not_allowed"]);
    const payload = row.decision_payload as Record<string, unknown>;
    expect(payload.proposedOrder).toBeNull();
    expect(payload.resolvedIntent).toBe("HOLD");
  });

  it("stamps the candle id and includes all matched signal ids in the payload", () => {
    const row = buildQuoteAssetNotAllowedSkipDecision(baseArgs);
    expect(row.candle_id).toBe("candle-1");
    const payload = row.decision_payload as Record<string, unknown>;
    expect(payload.signalIds).toEqual(["sig-1", "sig-2"]);
    expect(payload.signalsIn).toEqual([
      { id: "sig-1", intent: "ENTER", agent_id: "ma-cross" },
      { id: "sig-2", intent: "ENTER", agent_id: "rsi-oversold" },
    ]);
  });

  it("threads market + executor + quote-asset identifiers into the decision payload", () => {
    const row = buildQuoteAssetNotAllowedSkipDecision(baseArgs);
    const payload = row.decision_payload as Record<string, unknown>;
    expect(payload.market_symbol).toBe("GIGA-EUR");
    expect(payload.executorId).toBe("exec-1");
    expect(payload.executorName).toBe("Default");
    expect(payload.exchangeId).toBe("exch-bitvavo");
    expect(payload.quoteAssetId).toBe("asset-eur");
    expect(payload.barCloseTimeIso).toBe("2026-05-14T17:00:00Z");
  });

  it("conditionally includes optional sync-run ids when provided", () => {
    const withSync = buildQuoteAssetNotAllowedSkipDecision({
      ...baseArgs,
      candleSyncRunId: "candle-run-1",
      signalsSyncRunId: "signals-run-1",
      mediatorPipelineSyncRunId: "mediator-run-1",
    });
    const payload = withSync.decision_payload as Record<string, unknown>;
    expect(payload.candleSyncRunId).toBe("candle-run-1");
    expect(payload.signalsSyncRunId).toBe("signals-run-1");
    expect(payload.mediatorSyncRunId).toBe("mediator-run-1");

    const withoutSync = buildQuoteAssetNotAllowedSkipDecision(baseArgs);
    const payloadEmpty = withoutSync.decision_payload as Record<string, unknown>;
    expect(payloadEmpty).not.toHaveProperty("candleSyncRunId");
    expect(payloadEmpty).not.toHaveProperty("signalsSyncRunId");
    expect(payloadEmpty).not.toHaveProperty("mediatorSyncRunId");
  });
});
