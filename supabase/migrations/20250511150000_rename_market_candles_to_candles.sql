-- Catalog OHLCV table: `market_candles` -> `candles` (global rows, `market_id` FK to `markets`).
-- Legacy per-user `candles` was already dropped in 20250511140000.

alter table public.market_candles rename to candles;

alter index public.market_candles_close_idx rename to candles_market_close_idx;
alter index public.market_candles_close_time_idx rename to candles_close_time_idx;

alter policy market_candles_select_all on public.candles rename to candles_select_all;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.candles'::regclass
      and conname = 'market_candles_pkey'
  ) then
    alter table public.candles rename constraint market_candles_pkey to candles_pkey;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.candles'::regclass
      and conname = 'market_candles_market_timeframe_close_key'
  ) then
    alter table public.candles rename constraint market_candles_market_timeframe_close_key
      to candles_market_timeframe_close_key;
  end if;
end $$;
