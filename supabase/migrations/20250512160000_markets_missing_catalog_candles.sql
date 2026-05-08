-- Efficient lookup for markets that have no rows in `candles` for a given timeframe (backfill after market sync).

create or replace function public.markets_missing_catalog_candles(
  p_exchange_id uuid,
  p_quote text,
  p_timeframe text
)
returns table (id uuid, market_symbol text)
language sql
stable
as $$
  select m.id, m.market_symbol
  from public.markets m
  where m.exchange_id = p_exchange_id
    and m.quote_code = upper(trim(p_quote))
    and not exists (
      select 1
      from public.candles c
      where c.market_id = m.id
        and c.timeframe = p_timeframe
    )
  order by m.market_symbol asc;
$$;

grant execute on function public.markets_missing_catalog_candles(uuid, text, text) to service_role;
