-- Historical mode columns, constraints, and run log (runs after enum value exists).

alter table trading.executors
  add column if not exists historical_start_date date,
  add column if not exists historical_end_date date;

comment on column trading.executors.historical_start_date is
  'Inclusive calendar start date for historical mode (UTC date; paired with historical_end_date).';
comment on column trading.executors.historical_end_date is
  'Inclusive calendar end date for historical mode (UTC date).';

alter table trading.executors drop constraint if exists executors_historical_dates_chk;
alter table trading.executors
  add constraint executors_historical_dates_chk check (
    execution_mode <> 'historical'::trading.execution_mode
    or (
      historical_start_date is not null
      and historical_end_date is not null
      and historical_start_date <= historical_end_date
    )
  );

alter table trading.executors drop constraint if exists executors_historical_slack_off_chk;
alter table trading.executors
  add constraint executors_historical_slack_off_chk check (
    not (
      execution_mode = 'historical'::trading.execution_mode
      and slack_trade_notifications_enabled = true
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'trading' and t.typname = 'executor_historical_run_status'
  ) then
    create type trading.executor_historical_run_status as enum ('queued', 'running', 'completed', 'failed');
  end if;
end $$;

create table if not exists trading.executor_historical_runs (
  id uuid primary key default gen_random_uuid(),
  executor_id uuid not null references trading.executors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status trading.executor_historical_run_status not null default 'queued',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  bars_total integer,
  bars_done integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists executor_historical_runs_executor_started_idx
  on trading.executor_historical_runs (executor_id, started_at desc);

alter table trading.executor_historical_runs enable row level security;

drop policy if exists executor_historical_runs_select on trading.executor_historical_runs;
create policy executor_historical_runs_select on trading.executor_historical_runs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists executor_historical_runs_insert on trading.executor_historical_runs;
create policy executor_historical_runs_insert on trading.executor_historical_runs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists executor_historical_runs_update on trading.executor_historical_runs;
create policy executor_historical_runs_update on trading.executor_historical_runs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on trading.executor_historical_runs to authenticated;
grant all on trading.executor_historical_runs to service_role;
