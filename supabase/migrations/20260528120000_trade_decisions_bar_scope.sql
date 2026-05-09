-- Bar-scoped trade decisions + idempotent upsert per closed candle.

alter table trading.trade_decisions
  add column if not exists close_time timestamptz,
  add column if not exists timeframe text,
  add column if not exists paper boolean not null default true;

update trading.trade_decisions
set
  close_time = coalesce(close_time, created_at),
  timeframe = coalesce(timeframe, '5m')
where close_time is null or timeframe is null;

alter table trading.trade_decisions alter column close_time set not null;
alter table trading.trade_decisions alter column timeframe set not null;

create unique index if not exists trade_decisions_user_market_timeframe_close_uidx
  on trading.trade_decisions (user_id, market_id, timeframe, close_time);
