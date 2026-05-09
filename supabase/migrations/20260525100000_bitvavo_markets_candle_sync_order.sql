-- Stable ordering for Bitvavo candle sweeps: highest base-asset market cap first (e.g. BTC-EUR before long-tail).

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
      or upper(m.quote_code) = upper(trim(p_quote))
    )
  order by a.coingecko_market_cap_usd desc nulls last, m.market_symbol asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 1), 1);
$$;

comment on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) is
  'Paged Bitvavo markets for candle sync: base asset coingecko_market_cap_usd desc (nulls last), then market_symbol.';

revoke all on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) from public;
grant execute on function catalog.bitvavo_markets_for_candle_sync_slice(uuid, text, int, int) to service_role;
