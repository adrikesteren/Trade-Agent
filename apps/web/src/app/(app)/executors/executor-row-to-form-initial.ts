import type { ExecutionModeValue, ExecutorAssetFilterMode } from "./actions";
import type { ExecutorFormInitial } from "./executor-form";

/** Shape returned from `trading.executors` selects used for edit / clone forms. */
export type ExecutorRowForFormInitial = {
  name: unknown;
  enabled: unknown;
  execution_mode: unknown;
  exchange_id: unknown;
  asset_filter_mode: unknown;
  filter_asset_ids: unknown;
  default_notional_eur: unknown;
  max_risk_per_trade: unknown;
  max_open_positions: unknown;
  max_exposure_per_symbol_eur: unknown;
  daily_loss_limit_eur: unknown;
  max_drawdown_eur: unknown;
  cooldown_after_losses: unknown;
  allow_add: unknown;
  mediator_rails_extra: unknown;
  profit_taking_enabled: unknown;
  moving_floor_trail_pct: unknown;
  moving_floor_activation_profit_pct: unknown;
  moving_floor_timeframe: unknown;
  slack_trade_notifications_enabled?: unknown;
  exchange_api_key?: unknown;
  exchange_api_secret?: unknown;
  historical_start_date?: unknown;
  historical_end_date?: unknown;
};

export function executorRowToFormInitial(
  ex: ExecutorRowForFormInitial,
  options?: { nameOverride?: string },
): ExecutorFormInitial {
  const filterIds = (ex.filter_asset_ids as string[] | null) ?? [];

  const slackTradeNotificationsEnabled =
    (ex as { slack_trade_notifications_enabled?: boolean | null }).slack_trade_notifications_enabled !== false;

  const exKey = String((ex as { exchange_api_key?: string | null }).exchange_api_key ?? "").trim();
  const exSecret = String((ex as { exchange_api_secret?: string | null }).exchange_api_secret ?? "").trim();
  const exchangeApiCredentialsConfigured = exKey.length > 0 && exSecret.length > 0;
  const exchangeApiKeySuffix =
    exKey.length >= 4 ? exKey.slice(-4) : exKey.length > 0 ? "****" : undefined;

  const extraRaw = ex.mediator_rails_extra as unknown;
  const mediator_rails_extra_json =
    extraRaw != null && typeof extraRaw === "object" ? JSON.stringify(extraRaw, null, 2) : "{}";

  const baseName = String(ex.name ?? "").trim();
  const name =
    options?.nameOverride !== undefined
      ? options.nameOverride
      : baseName;

  return {
    name,
    enabled: Boolean(ex.enabled),
    execution_mode: ex.execution_mode as ExecutionModeValue,
    exchange_id: String(ex.exchange_id ?? ""),
    asset_filter_mode: ex.asset_filter_mode as ExecutorAssetFilterMode,
    filter_asset_ids: filterIds,
    default_notional_eur: String(ex.default_notional_eur ?? "100"),
    max_risk_per_trade: String(ex.max_risk_per_trade ?? "0.05"),
    max_open_positions: String(ex.max_open_positions ?? "5"),
    max_exposure_per_symbol_eur: String(ex.max_exposure_per_symbol_eur ?? "500"),
    daily_loss_limit_eur: String(ex.daily_loss_limit_eur ?? "100"),
    max_drawdown_eur: String(ex.max_drawdown_eur ?? "500"),
    cooldown_after_losses: String(ex.cooldown_after_losses ?? "3"),
    allow_add: Boolean(ex.allow_add),
    profit_taking_enabled: Boolean(ex.profit_taking_enabled),
    moving_floor_trail_pct: String(ex.moving_floor_trail_pct ?? "0.15"),
    moving_floor_activation_profit_pct: String(ex.moving_floor_activation_profit_pct ?? "0.05"),
    moving_floor_timeframe: String(ex.moving_floor_timeframe ?? "15m"),
    mediator_rails_extra_json,
    slack_trade_notifications_enabled: slackTradeNotificationsEnabled,
    exchange_api_credentials_configured: exchangeApiCredentialsConfigured,
    exchange_api_key_suffix: exchangeApiKeySuffix,
    historical_start_date: (ex as { historical_start_date?: string | null }).historical_start_date ?? null,
    historical_end_date: (ex as { historical_end_date?: string | null }).historical_end_date ?? null,
  };
}
