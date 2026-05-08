-- Reset catalog OHLCV before re-syncing as 1m-only base bars.
-- Older rows used mixed timeframes (e.g. 1h); the app now stores 1m and aggregates client/API-side.
-- Signals referencing deleted rows: FK market_candle_id -> ON DELETE SET NULL.

delete from public.market_candles;
