-- Resolve quote text to catalog.assets.id (fiat ISO set vs crypto). Used by candle helpers.
-- IN list must match apps/web/src/lib/markets/fiat-quote-currency-codes.ts

create or replace function catalog.resolve_quote_asset_id_by_code(p_code text)
returns uuid
language sql
stable
set search_path = catalog, public
as $$
  select case
    when upper(trim(p_code)) in (
      'EUR', 'USD', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'ISK',
      'TRY', 'JPY', 'CNY', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN', 'ZAR', 'ILS', 'INR', 'KRW',
      'THB', 'PHP', 'IDR', 'MYR'
    ) then (
      select a.id
      from catalog.assets a
      where a.kind = 'fiat'::public.asset_kind
        and a.code = upper(trim(p_code))
      limit 1
    )
    else (
      select a.id
      from catalog.assets a
      where a.kind = 'crypto'::public.asset_kind
        and a.code = upper(trim(p_code))
      limit 1
    )
  end;
$$;

comment on function catalog.resolve_quote_asset_id_by_code(text) is
  'Map Bitvavo quote symbol to catalog.assets.id: seeded fiat ISO codes resolve to kind=fiat, else kind=crypto.';

revoke all on function catalog.resolve_quote_asset_id_by_code(text) from public;
grant execute on function catalog.resolve_quote_asset_id_by_code(text) to service_role;
grant execute on function catalog.resolve_quote_asset_id_by_code(text) to authenticated;

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
    and m.quote_asset_id = catalog.resolve_quote_asset_id_by_code(p_quote)
    and not exists (
      select 1
      from catalog.candles c
      where c.market_id = m.id
        and c.timeframe = p_timeframe
    )
  order by m.market_symbol asc;
$$;

grant execute on function public.markets_missing_catalog_candles(uuid, text, text) to service_role;

create or replace function catalog.bitvavo_markets_for_candle_sync_slice(
  p_exchange_id uuid,
  p_quote text,
  p_offset int,
  p_limit int
)
returns table (id uuid, market_symbol text)
language sql
stable
set search_path = catalog, public
as $$
  select m.id, m.market_symbol
  from catalog.markets m
  left join catalog.assets a on a.id = m.asset_id
  where m.exchange_id = p_exchange_id
    and (
      p_quote is null
      or length(trim(p_quote)) = 0
      or m.quote_asset_id = catalog.resolve_quote_asset_id_by_code(p_quote)
    )
  order by a.coingecko_market_cap_usd desc nulls last, m.market_symbol asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 1), 1);
$$;

comment on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) is
  'Paged Bitvavo markets for candle sync: base asset coingecko_market_cap_usd desc (nulls last), then market_symbol.';

revoke all on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) from public;
grant execute on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) to service_role;
