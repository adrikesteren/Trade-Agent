import type { ProposedOrder, RiskRailsConfig, RiskStateSnapshot } from "./types";

export type RiskEvaluation = {
  allowed: boolean;
  reasonCodes: string[];
};

/**
 * Pure risk gate: if anything is uncertain or limits breached, deny new entries.
 * Callers should treat `allowed === false` as hard stop for **new** risk-increasing orders.
 */
export function evaluateNewEntry(
  config: RiskRailsConfig,
  state: RiskStateSnapshot,
  proposed: ProposedOrder,
): RiskEvaluation {
  const reasonCodes: string[] = [];

  if (state.killSwitch) {
    reasonCodes.push("kill_switch");
  }
  if (state.dailyPnlEur <= -Math.abs(config.dailyLossLimitEur)) {
    reasonCodes.push("daily_loss_limit");
  }
  if (state.maxDrawdownEur >= config.maxDrawdownEur) {
    reasonCodes.push("max_drawdown");
  }
  if (state.consecutiveLosses >= config.cooldownAfterLosses) {
    reasonCodes.push("loss_cooldown");
  }
  if (state.openPositionCount >= config.maxOpenPositions) {
    reasonCodes.push("max_open_positions");
  }

  const symExposure = state.exposureBySymbolEur[proposed.symbol] ?? 0;
  if (symExposure + proposed.notionalEur > config.maxExposurePerSymbolEur) {
    reasonCodes.push("max_symbol_exposure");
  }

  const maxNotional = state.equityEur * config.maxRiskPerTrade;
  if (proposed.notionalEur > maxNotional) {
    reasonCodes.push("max_risk_per_trade");
  }

  if (state.equityEur <= 0) {
    reasonCodes.push("non_positive_equity");
  }

  return { allowed: reasonCodes.length === 0, reasonCodes };
}
