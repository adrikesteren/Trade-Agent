-- Fix: BEFORE INSERT trigger on `trading.executor_quote_asset_budget` calls
-- `nextval('trading.executor_quote_asset_budget_name_seq')` to fill the
-- auto-name (EQB-{0000}). The trigger function is NOT `SECURITY DEFINER`,
-- so it runs as the calling role — which is `authenticated` when the user
-- saves the executor form. Without `USAGE` on the sequence, Postgres raises
-- "permission denied for sequence executor_quote_asset_budget_name_seq".
--
-- Other auto-name tables (`trading.orders`, `trading.decisions`, etc.) have
-- the same shape but are only ever inserted by service_role / automation
-- code, so the missing grant never bites in practice. The quote-asset
-- budget table is unique in that humans insert via the executor form, so
-- it needs the grant.

grant usage on sequence trading.executor_quote_asset_budget_name_seq
  to authenticated, service_role;
