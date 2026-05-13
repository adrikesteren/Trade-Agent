-- When the current session is the catalog `automated_process` user (`auth.uid()` matches
-- `automation_actor` / `user_profiles.username`), allow **SELECT** on all trading rows in these
-- tables (same set as 20260628120000). Workers still use service_role and bypass RLS.

drop policy if exists signals_select on trading.signals;
create policy signals_select on trading.signals
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists trade_decisions_select on trading.trade_decisions;
create policy trade_decisions_select on trading.trade_decisions
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists orders_select on trading.orders;
create policy orders_select on trading.orders
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists fills_select on trading.fills;
create policy fills_select on trading.fills
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists positions_select on trading.positions;
create policy positions_select on trading.positions
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists executors_select on trading.executors;
create policy executors_select on trading.executors
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists risk_state_select on trading.risk_state;
create policy risk_state_select on trading.risk_state
  for select to authenticated
  using (
    (
      auth.uid() = user_id
      and exists (
        select 1 from trading.executors e
        where e.id = risk_state.executor_id and e.user_id = auth.uid()
      )
    )
    or (
      public.is_catalog_automated_process_user(user_id)
      and exists (
        select 1 from trading.executors e
        where e.id = risk_state.executor_id and public.is_catalog_automated_process_user(e.user_id)
      )
    )
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists executor_balance_ledger_select on trading.executor_balance_ledger;
create policy executor_balance_ledger_select on trading.executor_balance_ledger
  for select to authenticated
  using (
    (
      auth.uid() = user_id
      and exists (
        select 1 from trading.executors e
        where e.id = executor_balance_ledger.executor_id and e.user_id = auth.uid()
      )
    )
    or (
      public.is_catalog_automated_process_user(user_id)
      and exists (
        select 1 from trading.executors e
        where e.id = executor_balance_ledger.executor_id and public.is_catalog_automated_process_user(e.user_id)
      )
    )
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists executor_historical_runs_select on trading.executor_historical_runs;
create policy executor_historical_runs_select on trading.executor_historical_runs
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );

drop policy if exists executor_moving_floors_select on trading.executor_moving_floors;
create policy executor_moving_floors_select on trading.executor_moving_floors
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_catalog_automated_process_user(user_id)
    or public.is_catalog_automated_process_user(auth.uid())
  );
