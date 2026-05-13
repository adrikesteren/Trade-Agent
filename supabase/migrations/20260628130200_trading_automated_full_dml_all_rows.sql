-- Full DML for catalog `automated_process` when `auth.uid()` is that user (same helper as SELECT).
-- USING (update/delete): own row OR row owned by automated OR caller is automated.
-- WITH CHECK (insert / post-update): own `user_id` OR caller is automated (no spoofing automated rows by normal users).
--
-- Tables: signals, trade_decisions, orders, fills, positions, executors, risk_state,
--         executor_balance_ledger, executor_historical_runs, executor_moving_floors.

-- Drop overloads from a failed partial apply (no-op if absent)
drop function if exists public.trading_risk_state_row_accessible();
drop function if exists public.trading_balance_ledger_row_accessible();

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: `auth.uid()` is still the invoker)
-- ---------------------------------------------------------------------------

create or replace function public.trading_row_accessible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_user_id
    or public.is_catalog_automated_process_user(p_user_id)
    or public.is_catalog_automated_process_user(auth.uid());
$$;

revoke all on function public.trading_row_accessible(uuid) from public;
grant execute on function public.trading_row_accessible(uuid) to authenticated, service_role;

create or replace function public.trading_row_insert_check(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_user_id
    or public.is_catalog_automated_process_user(auth.uid());
$$;

revoke all on function public.trading_row_insert_check(uuid) from public;
grant execute on function public.trading_row_insert_check(uuid) to authenticated, service_role;

create or replace function public.trading_risk_state_row_accessible(p_user_id uuid, p_executor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, trading
as $$
  select public.is_catalog_automated_process_user(auth.uid())
    or (
      auth.uid() = p_user_id
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and e.user_id = auth.uid()
      )
    )
    or (
      public.is_catalog_automated_process_user(p_user_id)
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and public.is_catalog_automated_process_user(e.user_id)
      )
    );
$$;

revoke all on function public.trading_risk_state_row_accessible(uuid, uuid) from public;
grant execute on function public.trading_risk_state_row_accessible(uuid, uuid) to authenticated, service_role;

create or replace function public.trading_risk_state_insert_check(p_user_id uuid, p_executor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, trading
as $$
  select public.is_catalog_automated_process_user(auth.uid())
    or (
      auth.uid() = p_user_id
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and e.user_id = auth.uid()
      )
    );
$$;

revoke all on function public.trading_risk_state_insert_check(uuid, uuid) from public;
grant execute on function public.trading_risk_state_insert_check(uuid, uuid) to authenticated, service_role;

create or replace function public.trading_balance_ledger_row_accessible(p_user_id uuid, p_executor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, trading
as $$
  select public.is_catalog_automated_process_user(auth.uid())
    or (
      auth.uid() = p_user_id
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and e.user_id = auth.uid()
      )
    )
    or (
      public.is_catalog_automated_process_user(p_user_id)
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and public.is_catalog_automated_process_user(e.user_id)
      )
    );
$$;

revoke all on function public.trading_balance_ledger_row_accessible(uuid, uuid) from public;
grant execute on function public.trading_balance_ledger_row_accessible(uuid, uuid) to authenticated, service_role;

create or replace function public.trading_balance_ledger_insert_check(p_user_id uuid, p_executor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, trading
as $$
  select public.is_catalog_automated_process_user(auth.uid())
    or (
      auth.uid() = p_user_id
      and exists (
        select 1 from trading.executors e
        where e.id = p_executor_id and e.user_id = auth.uid()
      )
    );
$$;

revoke all on function public.trading_balance_ledger_insert_check(uuid, uuid) from public;
grant execute on function public.trading_balance_ledger_insert_check(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- signals
-- ---------------------------------------------------------------------------

drop policy if exists signals_insert on trading.signals;
create policy signals_insert on trading.signals
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists signals_update on trading.signals;
create policy signals_update on trading.signals
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists signals_delete on trading.signals;
create policy signals_delete on trading.signals
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- trade_decisions
-- ---------------------------------------------------------------------------

drop policy if exists trade_decisions_insert on trading.trade_decisions;
create policy trade_decisions_insert on trading.trade_decisions
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists trade_decisions_update on trading.trade_decisions;
create policy trade_decisions_update on trading.trade_decisions
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists trade_decisions_delete on trading.trade_decisions;
create policy trade_decisions_delete on trading.trade_decisions
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

drop policy if exists orders_insert on trading.orders;
create policy orders_insert on trading.orders
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists orders_update on trading.orders;
create policy orders_update on trading.orders
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists orders_delete on trading.orders;
create policy orders_delete on trading.orders
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- fills
-- ---------------------------------------------------------------------------

drop policy if exists fills_insert on trading.fills;
create policy fills_insert on trading.fills
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists fills_update on trading.fills;
create policy fills_update on trading.fills
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists fills_delete on trading.fills;
create policy fills_delete on trading.fills
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------

drop policy if exists positions_insert on trading.positions;
create policy positions_insert on trading.positions
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists positions_update on trading.positions;
create policy positions_update on trading.positions
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists positions_delete on trading.positions;
create policy positions_delete on trading.positions
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- executors
-- ---------------------------------------------------------------------------

drop policy if exists executors_insert on trading.executors;
create policy executors_insert on trading.executors
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executors_update on trading.executors;
create policy executors_update on trading.executors
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executors_delete on trading.executors;
create policy executors_delete on trading.executors
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- risk_state
-- ---------------------------------------------------------------------------

drop policy if exists risk_state_insert on trading.risk_state;
create policy risk_state_insert on trading.risk_state
  for insert to authenticated
  with check (public.trading_risk_state_insert_check(user_id, executor_id));

drop policy if exists risk_state_update on trading.risk_state;
create policy risk_state_update on trading.risk_state
  for update to authenticated
  using (public.trading_risk_state_row_accessible(user_id, executor_id))
  with check (public.trading_risk_state_insert_check(user_id, executor_id));

drop policy if exists risk_state_delete on trading.risk_state;
create policy risk_state_delete on trading.risk_state
  for delete to authenticated
  using (public.trading_risk_state_row_accessible(user_id, executor_id));

-- ---------------------------------------------------------------------------
-- executor_balance_ledger
-- ---------------------------------------------------------------------------

drop policy if exists executor_balance_ledger_insert on trading.executor_balance_ledger;
create policy executor_balance_ledger_insert on trading.executor_balance_ledger
  for insert to authenticated
  with check (public.trading_balance_ledger_insert_check(user_id, executor_id));

drop policy if exists executor_balance_ledger_update on trading.executor_balance_ledger;
create policy executor_balance_ledger_update on trading.executor_balance_ledger
  for update to authenticated
  using (public.trading_balance_ledger_row_accessible(user_id, executor_id))
  with check (public.trading_balance_ledger_insert_check(user_id, executor_id));

drop policy if exists executor_balance_ledger_delete on trading.executor_balance_ledger;
create policy executor_balance_ledger_delete on trading.executor_balance_ledger
  for delete to authenticated
  using (public.trading_balance_ledger_row_accessible(user_id, executor_id));

-- ---------------------------------------------------------------------------
-- executor_historical_runs
-- ---------------------------------------------------------------------------

drop policy if exists executor_historical_runs_insert on trading.executor_historical_runs;
create policy executor_historical_runs_insert on trading.executor_historical_runs
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executor_historical_runs_update on trading.executor_historical_runs;
create policy executor_historical_runs_update on trading.executor_historical_runs
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executor_historical_runs_delete on trading.executor_historical_runs;
create policy executor_historical_runs_delete on trading.executor_historical_runs
  for delete to authenticated
  using (public.trading_row_accessible(user_id));

-- ---------------------------------------------------------------------------
-- executor_moving_floors
-- ---------------------------------------------------------------------------

drop policy if exists executor_moving_floors_insert on trading.executor_moving_floors;
create policy executor_moving_floors_insert on trading.executor_moving_floors
  for insert to authenticated
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executor_moving_floors_update on trading.executor_moving_floors;
create policy executor_moving_floors_update on trading.executor_moving_floors
  for update to authenticated
  using (public.trading_row_accessible(user_id))
  with check (public.trading_row_insert_check(user_id));

drop policy if exists executor_moving_floors_delete on trading.executor_moving_floors;
create policy executor_moving_floors_delete on trading.executor_moving_floors
  for delete to authenticated
  using (public.trading_row_accessible(user_id));
