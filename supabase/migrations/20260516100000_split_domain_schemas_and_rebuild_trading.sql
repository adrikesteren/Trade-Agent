-- Domain schema split:
-- - catalog: market reference + candles
-- - trading: signals/decisions/orders state
-- - automation: job/run orchestration
-- Data is preserved by moving existing tables out of public.

create schema if not exists catalog;
create schema if not exists trading;
create schema if not exists automation;

grant usage on schema catalog to anon, authenticated, service_role;
grant usage on schema trading to authenticated, service_role;
grant usage on schema automation to authenticated, service_role;

-- Move existing catalog and automation tables with data preserved.
do $$
begin
  if to_regclass('public.assets') is not null and to_regclass('catalog.assets') is null then
    execute 'alter table public.assets set schema catalog';
  end if;
  if to_regclass('public.exchanges') is not null and to_regclass('catalog.exchanges') is null then
    execute 'alter table public.exchanges set schema catalog';
  end if;
  if to_regclass('public.markets') is not null and to_regclass('catalog.markets') is null then
    execute 'alter table public.markets set schema catalog';
  end if;
  if to_regclass('public.candles') is not null and to_regclass('catalog.candles') is null then
    execute 'alter table public.candles set schema catalog';
  end if;
  if to_regclass('public.sync_runs') is not null and to_regclass('automation.sync_runs') is null then
    execute 'alter table public.sync_runs set schema automation';
  end if;
end $$;

-- Refresh grants for moved tables.
grant select on all tables in schema catalog to authenticated;
grant select on all tables in schema automation to authenticated;

-- Rebind helper functions to new catalog schema.
create or replace function public.markets_missing_catalog_candles(
  p_exchange_id uuid,
  p_quote text,
  p_timeframe text
)
returns table (id uuid, market_symbol text)
language sql
stable
set search_path = public, catalog
as $$
  select m.id, m.market_symbol
  from catalog.markets m
  where m.exchange_id = p_exchange_id
    and m.quote_code = upper(trim(p_quote))
    and not exists (
      select 1
      from catalog.candles c
      where c.market_id = m.id
        and c.timeframe = p_timeframe
    )
  order by m.market_symbol asc;
$$;

grant execute on function public.markets_missing_catalog_candles(uuid, text, text) to service_role;

create or replace function public.latest_market_cap_by_assets(_asset_ids uuid[])
returns table (asset_id uuid, market_cap_usd numeric)
language sql
stable
security invoker
set search_path = public, catalog
as $$
  select
    a.id as asset_id,
    a.coingecko_market_cap_usd as market_cap_usd
  from catalog.assets a
  where a.id = any(coalesce(_asset_ids, array[]::uuid[]));
$$;

grant execute on function public.latest_market_cap_by_assets(uuid[]) to authenticated;
grant execute on function public.latest_market_cap_by_assets(uuid[]) to service_role;

-- Trading domain types.
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'trading'::regnamespace and typname = 'signal_intent') then
    create type trading.signal_intent as enum ('ENTER', 'ADD', 'REDUCE', 'EXIT', 'HOLD');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'trading'::regnamespace and typname = 'order_side') then
    create type trading.order_side as enum ('buy', 'sell');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'trading'::regnamespace and typname = 'order_status') then
    create type trading.order_status as enum ('pending', 'open', 'filled', 'cancelled', 'rejected');
  end if;
end $$;

create table if not exists trading.signal_agents (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null unique,
  enabled boolean not null default true,
  version text,
  description text,
  config jsonb not null default '{}'::jsonb,
  allowed_timeframes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trading.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_id text not null references trading.signal_agents (agent_id) on delete restrict,
  market_id uuid not null references catalog.markets (id) on delete restrict,
  candle_id uuid references catalog.candles (id) on delete set null,
  timeframe text not null,
  close_time timestamptz not null,
  intent trading.signal_intent not null,
  confidence numeric,
  reasons jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (agent_id, market_id, timeframe, close_time)
);

create index if not exists signals_user_created_idx
  on trading.signals (user_id, created_at desc);
create index if not exists signals_market_timeframe_close_idx
  on trading.signals (market_id, timeframe, close_time desc);

create table if not exists trading.trade_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references catalog.markets (id) on delete restrict,
  signal_id uuid references trading.signals (id) on delete set null,
  approved boolean not null,
  reason_codes text[] not null default '{}'::text[],
  risk_snapshot jsonb not null default '{}'::jsonb,
  decision_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trade_decisions_user_created_idx
  on trading.trade_decisions (user_id, created_at desc);

create table if not exists trading.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  decision_id uuid references trading.trade_decisions (id) on delete set null,
  market_id uuid not null references catalog.markets (id) on delete restrict,
  side trading.order_side not null,
  quantity numeric not null,
  notional_eur numeric,
  status trading.order_status not null default 'pending',
  paper boolean not null default true,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx
  on trading.orders (user_id, created_at desc);

create table if not exists trading.fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid not null references trading.orders (id) on delete cascade,
  price numeric not null,
  quantity numeric not null,
  fee numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists fills_user_created_idx
  on trading.fills (user_id, created_at desc);

create table if not exists trading.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references catalog.markets (id) on delete restrict,
  quantity numeric not null default 0,
  avg_price numeric,
  paper boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, market_id, paper)
);

create table if not exists trading.risk_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  equity_eur numeric not null default 10000,
  open_position_count integer not null default 0,
  exposure_by_market jsonb not null default '{}'::jsonb,
  daily_pnl_eur numeric not null default 0,
  max_drawdown_eur numeric not null default 0,
  kill_switch boolean not null default false,
  consecutive_losses integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- Automation domain types and tables.
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'automation'::regnamespace and typname = 'signal_job_status') then
    create type automation.signal_job_status as enum ('queued', 'running', 'completed', 'failed', 'skipped');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'automation'::regnamespace and typname = 'signal_run_status') then
    create type automation.signal_run_status as enum ('running', 'completed', 'failed');
  end if;
end $$;

create table if not exists automation.signal_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null default 'signal_candle_closed',
  market_id uuid not null references catalog.markets (id) on delete cascade,
  timeframe text not null,
  close_time timestamptz not null,
  status automation.signal_job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  unique (job_key, market_id, timeframe, close_time)
);

create index if not exists signal_jobs_status_created_idx
  on automation.signal_jobs (status, created_at desc);

create table if not exists automation.signal_runs (
  id uuid primary key default gen_random_uuid(),
  signal_job_id uuid not null references automation.signal_jobs (id) on delete cascade,
  agent_id text not null references trading.signal_agents (agent_id) on delete restrict,
  signal_id uuid references trading.signals (id) on delete set null,
  status automation.signal_run_status not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists signal_runs_job_started_idx
  on automation.signal_runs (signal_job_id, started_at desc);

-- RLS
alter table trading.signal_agents enable row level security;
alter table trading.signals enable row level security;
alter table trading.trade_decisions enable row level security;
alter table trading.orders enable row level security;
alter table trading.fills enable row level security;
alter table trading.positions enable row level security;
alter table trading.risk_state enable row level security;

alter table automation.signal_jobs enable row level security;
alter table automation.signal_runs enable row level security;

drop policy if exists signal_agents_select_all on trading.signal_agents;
create policy signal_agents_select_all on trading.signal_agents
  for select to authenticated using (true);

drop policy if exists signals_select on trading.signals;
create policy signals_select on trading.signals
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists signals_insert on trading.signals;
create policy signals_insert on trading.signals
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists trade_decisions_select on trading.trade_decisions;
create policy trade_decisions_select on trading.trade_decisions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists trade_decisions_insert on trading.trade_decisions;
create policy trade_decisions_insert on trading.trade_decisions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists orders_select on trading.orders;
create policy orders_select on trading.orders
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists orders_insert on trading.orders;
create policy orders_insert on trading.orders
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists orders_update on trading.orders;
create policy orders_update on trading.orders
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fills_select on trading.fills;
create policy fills_select on trading.fills
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists fills_insert on trading.fills;
create policy fills_insert on trading.fills
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists positions_select on trading.positions;
create policy positions_select on trading.positions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists positions_insert on trading.positions;
create policy positions_insert on trading.positions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists positions_update on trading.positions;
create policy positions_update on trading.positions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists risk_state_select on trading.risk_state;
create policy risk_state_select on trading.risk_state
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists risk_state_insert on trading.risk_state;
create policy risk_state_insert on trading.risk_state
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists risk_state_update on trading.risk_state;
create policy risk_state_update on trading.risk_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists signal_jobs_select_authenticated on automation.signal_jobs;
create policy signal_jobs_select_authenticated on automation.signal_jobs
  for select to authenticated using (true);

drop policy if exists signal_runs_select_authenticated on automation.signal_runs;
create policy signal_runs_select_authenticated on automation.signal_runs
  for select to authenticated using (true);

