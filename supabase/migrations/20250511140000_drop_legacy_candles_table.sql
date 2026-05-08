-- Remove per-user `candles` table; OHLCV lives in catalog `market_candles` only.

alter table public.signals drop constraint if exists signals_candle_id_fkey;

alter table public.signals drop column if exists candle_id;

drop table if exists public.candles;
