-- Global market catalog: exchanges, canonical assets, listings per exchange, OHLCV per listing.
-- Read by any authenticated user; writes via service role (sync / workers).

create type public.asset_kind as enum ('crypto', 'stock');

create table public.exchanges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  kind public.asset_kind not null default 'crypto',
  code text not null,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kind, code)
);

create table public.exchange_assets (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.exchanges (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete restrict,
  market_symbol text not null,
  quote_code text,
  status text not null default 'trading',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (exchange_id, market_symbol)
);

create index exchange_assets_exchange_idx on public.exchange_assets (exchange_id);
create index exchange_assets_asset_idx on public.exchange_assets (asset_id);
create index exchange_assets_quote_idx on public.exchange_assets (quote_code);

create table public.exchange_candles (
  id uuid primary key default gen_random_uuid(),
  exchange_asset_id uuid not null references public.exchange_assets (id) on delete cascade,
  timeframe text not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  open_time timestamptz not null,
  close_time timestamptz not null,
  created_at timestamptz not null default now(),
  unique (exchange_asset_id, timeframe, close_time)
);

create index exchange_candles_close_idx on public.exchange_candles (exchange_asset_id, close_time desc);

-- Link signals to catalog candles (optional; legacy candle_id may remain null).
alter table public.signals
  add column if not exists exchange_candle_id uuid references public.exchange_candles (id) on delete set null;

create index signals_exchange_candle_idx on public.signals (exchange_candle_id);

-- Seed Bitvavo (idempotent)
insert into public.exchanges (code, name, metadata)
values ('bitvavo', 'Bitvavo', '{}'::jsonb)
on conflict (code) do nothing;

-- ---------- RLS (catalog readable by logged-in users) ----------
alter table public.exchanges enable row level security;
alter table public.assets enable row level security;
alter table public.exchange_assets enable row level security;
alter table public.exchange_candles enable row level security;

create policy exchanges_select_all on public.exchanges for select to authenticated using (true);
create policy assets_select_all on public.assets for select to authenticated using (true);
create policy exchange_assets_select_all on public.exchange_assets for select to authenticated using (true);
create policy exchange_candles_select_all on public.exchange_candles for select to authenticated using (true);
