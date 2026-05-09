-- CoinGecko USD fundamentals live on `assets` (one row per asset, overwritten each sync).
-- Removes append-only `asset_coingecko_metrics` to avoid duplicate rows / storage growth.

alter table public.assets
  add column if not exists coingecko_fetched_at timestamptz,
  add column if not exists coingecko_coin_id text,
  add column if not exists coingecko_price_usd numeric,
  add column if not exists coingecko_market_cap_usd numeric,
  add column if not exists coingecko_fdv_usd numeric,
  add column if not exists coingecko_total_volume_usd numeric,
  add column if not exists coingecko_high_24h_usd numeric,
  add column if not exists coingecko_low_24h_usd numeric,
  add column if not exists coingecko_price_change_24h_usd numeric,
  add column if not exists coingecko_price_change_24h_pct numeric,
  add column if not exists coingecko_price_change_7d_pct numeric,
  add column if not exists coingecko_market_cap_rank integer,
  add column if not exists coingecko_circulating_supply numeric,
  add column if not exists coingecko_total_supply numeric,
  add column if not exists coingecko_max_supply numeric,
  add column if not exists coingecko_ath_usd numeric,
  add column if not exists coingecko_ath_change_pct numeric,
  add column if not exists coingecko_raw jsonb not null default '{}'::jsonb;

comment on column public.assets.coingecko_fetched_at is 'Last CoinGecko /coins/markets refresh (UTC).';
comment on column public.assets.coingecko_market_cap_usd is 'Live market cap in USD from CoinGecko; same row updated each sync.';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'asset_coingecko_metrics'
  ) then
    update public.assets a
    set
      coingecko_fetched_at = s.fetched_at,
      coingecko_coin_id = s.coingecko_id,
      coingecko_price_usd = s.price_usd,
      coingecko_market_cap_usd = s.market_cap_usd,
      coingecko_fdv_usd = s.fully_diluted_valuation_usd,
      coingecko_total_volume_usd = s.total_volume_usd,
      coingecko_high_24h_usd = s.high_24h_usd,
      coingecko_low_24h_usd = s.low_24h_usd,
      coingecko_price_change_24h_usd = s.price_change_24h_usd,
      coingecko_price_change_24h_pct = s.price_change_24h_pct,
      coingecko_price_change_7d_pct = s.price_change_7d_pct,
      coingecko_market_cap_rank = s.market_cap_rank,
      coingecko_circulating_supply = s.circulating_supply,
      coingecko_total_supply = s.total_supply,
      coingecko_max_supply = s.max_supply,
      coingecko_ath_usd = s.ath_usd,
      coingecko_ath_change_pct = s.ath_change_pct,
      coingecko_raw = coalesce(s.raw, '{}'::jsonb)
    from (
      select distinct on (asset_id)
        asset_id,
        fetched_at,
        coingecko_id,
        price_usd,
        market_cap_usd,
        fully_diluted_valuation_usd,
        total_volume_usd,
        high_24h_usd,
        low_24h_usd,
        price_change_24h_usd,
        price_change_24h_pct,
        price_change_7d_pct,
        market_cap_rank,
        circulating_supply,
        total_supply,
        max_supply,
        ath_usd,
        ath_change_pct,
        raw
      from public.asset_coingecko_metrics
      order by asset_id, fetched_at desc
    ) s
    where a.id = s.asset_id;
  end if;
end $$;

create or replace function public.latest_market_cap_by_assets(_asset_ids uuid[])
returns table (asset_id uuid, market_cap_usd numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id as asset_id, a.coingecko_market_cap_usd as market_cap_usd
  from public.assets a
  where a.id = any(coalesce(_asset_ids, array[]::uuid[]));
$$;

comment on function public.latest_market_cap_by_assets(uuid[]) is
  'Reads coingecko_market_cap_usd from public.assets (live column). Used for ordering markets/assets.';

grant execute on function public.latest_market_cap_by_assets(uuid[]) to authenticated;
grant execute on function public.latest_market_cap_by_assets(uuid[]) to service_role;

drop table if exists public.asset_coingecko_metrics cascade;

create index if not exists assets_coingecko_market_cap_idx
  on public.assets (coingecko_market_cap_usd desc nulls last)
  where kind = 'crypto';
