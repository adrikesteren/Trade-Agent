-- Fix: every table with an auto-name trigger (`set_<table>_auto_name`) has a
-- companion `<table>_name_seq` sequence that the trigger reads via
-- `nextval()`. The trigger functions are plain `language plpgsql` without
-- `SECURITY DEFINER`, so they run as the calling role. When an authenticated
-- user OR the service_role inserts a row, that role needs `USAGE` on the
-- sequence, otherwise Postgres raises:
--
--   permission denied for sequence <table>_name_seq
--
-- The auto-name migrations (20260722020000 … 20260723100000) created the
-- sequences and triggers but never granted `USAGE`. In practice it bit when:
--   - the executor form inserts `executor_quote_asset_budget` as authenticated
--   - historical replay inserts `decisions` as service_role
--   - similar paths for orders / positions / wallets / wallet_asset_balance
--
-- This migration does three things:
--   1. Grants `USAGE, SELECT` on every existing auto-name sequence to both
--      `authenticated` and `service_role`. `SELECT` is included so the trigger
--      can call `currval()` / inspect, even though `nextval()` only needs USAGE.
--   2. Sets `ALTER DEFAULT PRIVILEGES` so any FUTURE sequence created in the
--      `trading`, `automation`, and `public` schemas (by these or future
--      auto-name migrations) automatically gets the grant. This prevents the
--      same bug from re-appearing on the next table.
--   3. Idempotent — re-running is a no-op.
--
-- `service_role` is included even though it is often a Supabase superuser-like
-- role: in stock Supabase it does NOT automatically have privileges on
-- non-`public` schemas / sequences, so explicit grants matter.

-- 1) Grants on every known auto-name sequence
grant usage, select on sequence trading.executor_quote_asset_budget_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.user_execution_preferences_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.wallet_asset_balance_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.wallets_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.positions_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.orders_name_seq
  to authenticated, service_role;
grant usage, select on sequence trading.decisions_name_seq
  to authenticated, service_role;
grant usage, select on sequence automation.schedules_name_seq
  to authenticated, service_role;
grant usage, select on sequence public.automation_actor_name_seq
  to authenticated, service_role;
grant usage, select on sequence public.system_settings_name_seq
  to authenticated, service_role;
grant usage, select on sequence public.user_profiles_name_seq
  to authenticated, service_role;
grant usage, select on sequence public.user_preferences_name_seq
  to authenticated, service_role;

-- 2) Default privileges for FUTURE sequences in the affected schemas.
-- Note: `alter default privileges` is scoped to the role that creates the
-- object. Supabase migrations run as the `postgres` role, so we set defaults
-- for that role. Sequences created by other roles (rare in this repo) still
-- need explicit grants, but that's a non-issue for our migration workflow.
alter default privileges in schema trading
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema automation
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
