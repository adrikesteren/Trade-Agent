export type RiskRailsConfig = {
  /** Max fraction of equity (0–1) for a single new entry. */
  maxRiskPerTrade: number;
  maxOpenPositions: number;
  maxExposurePerSymbolEur: number;
  dailyLossLimitEur: number;
  maxDrawdownEur: number;
  cooldownAfterLosses: number;
};

export type RiskStateSnapshot = {
  equityEur: number;
  openPositionCount: number;
  exposureBySymbolEur: Record<string, number>;
  dailyPnlEur: number;
  maxDrawdownEur: number;
  consecutiveLosses: number;
  killSwitch: boolean;
};

export type ProposedOrder = {
  symbol: string;
  side: "buy" | "sell";
  notionalEur: number;
};
