-- Rename catalog: exchange_assets -> markets, exchange_candles -> market_candles.

alter table public.signals drop constraint if exists signals_exchange_candle_id_fkey;

alter table public.exchange_assets rename to markets;
alter table public.exchange_candles rename to market_candles;

alter table public.market_candles rename column exchange_asset_id to market_id;
alter table public.signals rename column exchange_candle_id to market_candle_id;

alter table public.signals
  add constraint signals_market_candle_id_fkey
    foreign key (market_candle_id) references public.market_candles (id) on delete set null;

-- Friendly index / policy names (ignore if names already changed)
alter index public.exchange_assets_exchange_idx rename to markets_exchange_idx;
alter index public.exchange_assets_asset_idx rename to markets_asset_idx;
alter index public.exchange_assets_quote_idx rename to markets_quote_idx;
alter index public.exchange_candles_close_idx rename to market_candles_close_idx;
alter index public.exchange_candles_close_time_idx rename to market_candles_close_time_idx;
alter index public.signals_exchange_candle_idx rename to signals_market_candle_idx;

alter policy exchange_assets_select_all on public.markets rename to markets_select_all;
alter policy exchange_candles_select_all on public.market_candles rename to market_candles_select_all;

-- Optional: tidy unique constraint name if still the old one
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_candles'::regclass
      and conname = 'exchange_candles_exchange_asset_id_timeframe_close_time_key'
  ) then
    alter table public.market_candles rename constraint exchange_candles_exchange_asset_id_timeframe_close_time_key
      to market_candles_market_timeframe_close_key;
  end if;
end $$;
