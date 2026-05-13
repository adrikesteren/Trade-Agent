-- Close-time helpers for catalog-close pipelines: scope by `candles.timeframe` (and optionally market)
-- so `symbol-close-pipeline` does not pick a global `candle_timestamps` max from another timeframe/market.

create or replace function catalog.catalog_max_close_time_for_timeframe(p_timeframe text)
returns timestamptz
language sql
stable
security invoker
set search_path = catalog
as $$
  select max(ct.close_time)
  from catalog.candles c
  join catalog.candle_timestamps ct on ct.id = c.candle_timestamp_id
  where c.timeframe = p_timeframe;
$$;

create or replace function catalog.catalog_max_close_time_for_market_timeframe(p_market_id uuid, p_timeframe text)
returns timestamptz
language sql
stable
security invoker
set search_path = catalog
as $$
  select max(ct.close_time)
  from catalog.candles c
  join catalog.candle_timestamps ct on ct.id = c.candle_timestamp_id
  where c.market_id = p_market_id
    and c.timeframe = p_timeframe;
$$;

comment on function catalog.catalog_max_close_time_for_timeframe(text) is
  'Latest catalog bar close among all candles of the given timeframe (used after EUR candle sweep).';

comment on function catalog.catalog_max_close_time_for_market_timeframe(uuid, text) is
  'Latest catalog bar close for one market + timeframe (symbol-close-pipeline scoped run).';

grant execute on function catalog.catalog_max_close_time_for_timeframe(text) to authenticated, service_role;
grant execute on function catalog.catalog_max_close_time_for_market_timeframe(uuid, text) to authenticated, service_role;
