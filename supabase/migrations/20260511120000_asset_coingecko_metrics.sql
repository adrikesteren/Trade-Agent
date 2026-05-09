-- Periodic CoinGecko market data per catalog asset (fundamentals for Trade Mediator / future agents).
-- Written by service role from /api/workers/coingecko-metrics-sync; readable by any authenticated user.

create table public.asset_coingecko_metrics (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  fetched_at timestamptz not null default now(),
  coingecko_id text not null,
  price_usd numeric,
  market_cap_usd numeric,
  fully_diluted_valuation_usd numeric,
  total_volume_usd numeric,
  high_24h_usd numeric,
  low_24h_usd numeric,
  price_change_24h_usd numeric,
  price_change_24h_pct numeric,
  price_change_7d_pct numeric,
  market_cap_rank integer,
  circulating_supply numeric,
  total_supply numeric,
  max_supply numeric,
  ath_usd numeric,
  ath_change_pct numeric,
  raw jsonb not null default '{}'::jsonb
);

create index asset_coingecko_metrics_asset_fetched_idx on public.asset_coingecko_metrics (asset_id, fetched_at desc);

comment on table public.asset_coingecko_metrics is 'Snapshots from CoinGecko /coins/markets (vs USD); use latest row per asset_id for mediator context.';

alter table public.asset_coingecko_metrics enable row level security;

create policy asset_coingecko_metrics_select_all
  on public.asset_coingecko_metrics
  for select
  to authenticated
  using (true);
