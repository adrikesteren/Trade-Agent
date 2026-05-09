import type { MediatorRailsConfig } from "@repo/trading";

import type { ExecutorRow } from "./executors";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

/**
 * Builds mediator rails from typed executor columns, then merges `mediator_rails_extra`
 * (same keys as `MediatorRailsConfig` / risk package) when present.
 */
function asExtra(raw: ExecutorRow["mediator_rails_extra"]): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return isPlainObject(p) ? p : {};
    } catch {
      return {};
    }
  }
  return isPlainObject(raw) ? raw : {};
}

export function executorToMediatorRails(ex: ExecutorRow): MediatorRailsConfig {
  const base: MediatorRailsConfig = {
    maxRiskPerTrade: Number(ex.max_risk_per_trade),
    maxOpenPositions: Math.floor(Number(ex.max_open_positions)),
    maxExposurePerSymbolEur: Number(ex.max_exposure_per_symbol_eur),
    dailyLossLimitEur: Number(ex.daily_loss_limit_eur),
    maxDrawdownEur: Number(ex.max_drawdown_eur),
    cooldownAfterLosses: Math.floor(Number(ex.cooldown_after_losses)),
    allowAdd: Boolean(ex.allow_add),
  };

  const raw = asExtra(ex.mediator_rails_extra);
  if (Object.keys(raw).length === 0) {
    return base;
  }

  return {
    ...base,
    maxRiskPerTrade: num(raw.maxRiskPerTrade, base.maxRiskPerTrade),
    maxOpenPositions: int(raw.maxOpenPositions, base.maxOpenPositions),
    maxExposurePerSymbolEur: num(raw.maxExposurePerSymbolEur, base.maxExposurePerSymbolEur),
    dailyLossLimitEur: num(raw.dailyLossLimitEur, base.dailyLossLimitEur),
    maxDrawdownEur: num(raw.maxDrawdownEur, base.maxDrawdownEur),
    cooldownAfterLosses: int(raw.cooldownAfterLosses, base.cooldownAfterLosses),
    allowAdd: raw.allowAdd !== undefined ? bool(raw.allowAdd, false) : base.allowAdd,
  };
}

export function defaultNotionalFromExecutor(ex: ExecutorRow): number {
  const n = Number(ex.default_notional_eur);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return n;
}
