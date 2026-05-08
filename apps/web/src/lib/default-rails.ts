import type { RiskRailsConfig } from "@repo/risk";

/** Default rails for paper / early prod; tune per account later in DB. */
export const DEFAULT_RAILS: RiskRailsConfig = {
  maxRiskPerTrade: 0.05,
  maxOpenPositions: 10,
  maxExposurePerSymbolEur: 5000,
  dailyLossLimitEur: 200,
  maxDrawdownEur: 2000,
  cooldownAfterLosses: 5,
};
