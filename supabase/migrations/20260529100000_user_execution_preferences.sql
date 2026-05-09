-- Per-user Paper/Live execution mode + idempotent one order per trade_decision.

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'trading'::regnamespace and typname = 'execution_mode') then
    create type trading.execution_mode as enum ('paper', 'live');
  end if;
end $$;

create table if not exists trading.user_execution_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  execution_mode trading.execution_mode not null default 'paper',
  updated_at timestamptz not null default now()
);

create index if not exists user_execution_preferences_updated_idx
  on trading.user_execution_preferences (updated_at desc);

alter table trading.user_execution_preferences enable row level security;

drop policy if exists user_execution_preferences_select on trading.user_execution_preferences;
create policy user_execution_preferences_select on trading.user_execution_preferences
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_execution_preferences_insert on trading.user_execution_preferences;
create policy user_execution_preferences_insert on trading.user_execution_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_execution_preferences_update on trading.user_execution_preferences;
create policy user_execution_preferences_update on trading.user_execution_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on trading.user_execution_preferences to authenticated;
grant all on trading.user_execution_preferences to service_role;

-- At most one order row per approved decision (executor idempotency).
create unique index if not exists orders_decision_id_uidx
  on trading.orders (decision_id)
  where decision_id is not null;
