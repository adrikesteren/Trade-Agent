-- Speeds up DELETE ... WHERE close_time < now() - interval '1 day' (retention cleanup).
create index if not exists exchange_candles_close_time_idx on public.exchange_candles (close_time);
