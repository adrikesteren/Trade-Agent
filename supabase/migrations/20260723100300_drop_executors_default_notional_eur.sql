-- Drop the deprecated `default_notional_eur` column from `trading.executors`.
--
-- Quote-aware budgeting now lives entirely in `trading.executor_quote_asset_budget`
-- (one row per allowed quote asset, amount stored in the user's primary fiat and
-- converted to quote units at decision time via `asset.dollar_value`). The
-- transitional fallback was removed in the app layer (mediator + form + detail
-- page + executors-lookup), so the column is unused and safe to drop.
--
-- Note: the original column was added by `20260601100000_executor_rails_and_risk_per_executor.sql`
-- with a `executors_default_notional_positive` CHECK constraint and a `default_notional_eur = 100`
-- backfill. Both are removed implicitly by `drop column ... cascade`.

alter table trading.executors
  drop constraint if exists executors_default_notional_positive;

alter table trading.executors
  drop column if exists default_notional_eur;
