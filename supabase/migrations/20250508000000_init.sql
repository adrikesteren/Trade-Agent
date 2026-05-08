-- Trade Agent core schema + RLS (per-user).
-- Workers using SUPABASE_SERVICE_ROLE_KEY bypass RLS; they MUST scope writes by user_id from trusted job payloads.
-- See supabase/RLS-WORKERS.md

create extension if not exists "pgcrypto";

create type public.trade_mode as enum ('paper', 'micro', 'big_spender');
create type public.signal_action as enum ('buy', 'sell', 'hold');
create type public.order_side as enum ('buy', 'sell');
create type public.order_status as enum ('pending', 'open', 'filled', 'cancelled', 'rejected');

create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exchange text not null default 'bitvavo',
  mode public.trade_mode not null default 'paper',
  label text,
  api_key_configured boolean not null default false,
  allowlisted_symbols text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid references public.connectors (id) on delete set null,
  exchange text not null,
  symbol text not null,
  timeframe text not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  open_time timestamptz not null,
  close_time timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, exchange, symbol, timeframe, close_time)
);

create index candles_user_close_idx on public.candles (user_id, close_time desc);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid references public.connectors (id) on delete set null,
  candle_id uuid references public.candles (id) on delete set null,
  symbol text,
  agent_id text not null default 'stub',
  action public.signal_action not null,
  confidence numeric,
  reasons jsonb not null default '{}',
  invalidation jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index signals_user_created_idx on public.signals (user_id, created_at desc);

create table public.trade_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  signal_id uuid references public.signals (id) on delete set null,
  approved boolean not null,
  reason_codes text[] not null default '{}',
  risk_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index trade_decisions_user_created_idx on public.trade_decisions (user_id, created_at desc);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid references public.connectors (id) on delete set null,
  decision_id uuid references public.trade_decisions (id) on delete set null,
  side public.order_side not null,
  symbol text not null,
  quantity numeric not null,
  status public.order_status not null default 'pending',
  paper boolean not null default true,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  price numeric not null,
  quantity numeric not null,
  fee numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid not null references public.connectors (id) on delete cascade,
  symbol text not null,
  quantity numeric not null default 0,
  avg_price numeric,
  paper boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, connector_id, symbol, paper)
);

create table public.risk_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid not null references public.connectors (id) on delete cascade,
  equity_eur numeric not null default 10000,
  open_position_count integer not null default 0,
  exposure_by_symbol jsonb not null default '{}'::jsonb,
  daily_pnl_eur numeric not null default 0,
  max_drawdown_eur numeric not null default 0,
  kill_switch boolean not null default false,
  consecutive_losses integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, connector_id)
);

-- ---------- RLS ----------
alter table public.connectors enable row level security;
alter table public.candles enable row level security;
alter table public.signals enable row level security;
alter table public.trade_decisions enable row level security;
alter table public.orders enable row level security;
alter table public.fills enable row level security;
alter table public.positions enable row level security;
alter table public.risk_state enable row level security;

create policy connectors_select on public.connectors for select to authenticated using (auth.uid() = user_id);
create policy connectors_insert on public.connectors for insert to authenticated with check (auth.uid() = user_id);
create policy connectors_update on public.connectors for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy connectors_delete on public.connectors for delete to authenticated using (auth.uid() = user_id);

create policy candles_select on public.candles for select to authenticated using (auth.uid() = user_id);
create policy candles_insert on public.candles for insert to authenticated with check (auth.uid() = user_id);
create policy candles_update on public.candles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy candles_delete on public.candles for delete to authenticated using (auth.uid() = user_id);

create policy signals_select on public.signals for select to authenticated using (auth.uid() = user_id);
create policy signals_insert on public.signals for insert to authenticated with check (auth.uid() = user_id);

create policy trade_decisions_select on public.trade_decisions for select to authenticated using (auth.uid() = user_id);
create policy trade_decisions_insert on public.trade_decisions for insert to authenticated with check (auth.uid() = user_id);

create policy orders_select on public.orders for select to authenticated using (auth.uid() = user_id);
create policy orders_insert on public.orders for insert to authenticated with check (auth.uid() = user_id);
create policy orders_update on public.orders for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy fills_select on public.fills for select to authenticated using (auth.uid() = user_id);
create policy fills_insert on public.fills for insert to authenticated with check (auth.uid() = user_id);

create policy positions_select on public.positions for select to authenticated using (auth.uid() = user_id);
create policy positions_insert on public.positions for insert to authenticated with check (auth.uid() = user_id);
create policy positions_update on public.positions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy risk_state_select on public.risk_state for select to authenticated using (auth.uid() = user_id);
create policy risk_state_insert on public.risk_state for insert to authenticated with check (auth.uid() = user_id);
create policy risk_state_update on public.risk_state for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
