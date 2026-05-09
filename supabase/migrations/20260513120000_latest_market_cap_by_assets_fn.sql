-- Latest CoinGecko market cap per asset (for UI sort, e.g. markets table).
create or replace function public.latest_market_cap_by_assets(_asset_ids uuid[])
returns table (asset_id uuid, market_cap_usd numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (m.asset_id)
    m.asset_id,
    m.market_cap_usd
  from public.asset_coingecko_metrics m
  where m.asset_id = any(coalesce(_asset_ids, array[]::uuid[]))
  order by m.asset_id, m.fetched_at desc;
$$;

comment on function public.latest_market_cap_by_assets(uuid[]) is
  'Latest market_cap_usd per asset_id (by fetched_at). Used for ordering markets by base-asset size.';

grant execute on function public.latest_market_cap_by_assets(uuid[]) to authenticated;
grant execute on function public.latest_market_cap_by_assets(uuid[]) to service_role;
