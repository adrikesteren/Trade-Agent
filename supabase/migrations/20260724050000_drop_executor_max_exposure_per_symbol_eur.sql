-- Drop the `max_symbol_exposure` rail and its companion runtime-exposure JSON.
--
-- P1 of `drop_exposure_wire_regime`: the per-symbol exposure cap on
-- `trading.executors.max_exposure_per_symbol_eur` was gated by
-- `state.exposureBySymbolEur` (which the app read from
-- `trading.executors.risk_exposure_by_market`). That JSON column was never
-- updated by the trading flow — it was only reset by the historical wipe
-- service — so the gate either always passed or always blocked depending on
-- stale state. Per-trade sizing is already fully covered by:
--   * `max_risk_per_trade × equity` (risk evaluator)
--   * `trading.executor_quote_asset_budget.max_notional_primary` (mediator-side)
--
-- All app-level reads of these two columns were removed in the matching code
-- change; nothing else depends on them, so a hard drop is safe.

alter table trading.executors
  drop column if exists max_exposure_per_symbol_eur,
  drop column if exists risk_exposure_by_market;
