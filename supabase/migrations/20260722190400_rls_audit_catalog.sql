-- Audit RLS on catalog.* reference tables: every catalog row should be readable by every
-- authenticated user (no user-scoping, no automation pattern needed). The policies were
-- created under various legacy names in earlier migrations; this migration normalises them
-- to a single permissive `select_all` policy per table, idempotently.

-- catalog.assets
alter table catalog.assets enable row level security;
drop policy if exists assets_select_all on catalog.assets;
create policy assets_select_all on catalog.assets
  for select to authenticated using (true);
grant select on catalog.assets to authenticated;

-- catalog.exchanges
alter table catalog.exchanges enable row level security;
drop policy if exists exchanges_select_all on catalog.exchanges;
create policy exchanges_select_all on catalog.exchanges
  for select to authenticated using (true);
grant select on catalog.exchanges to authenticated;

-- catalog.markets
alter table catalog.markets enable row level security;
drop policy if exists markets_select_all on catalog.markets;
create policy markets_select_all on catalog.markets
  for select to authenticated using (true);
grant select on catalog.markets to authenticated;

-- catalog.candles
alter table catalog.candles enable row level security;
drop policy if exists candles_select_all on catalog.candles;
create policy candles_select_all on catalog.candles
  for select to authenticated using (true);
grant select on catalog.candles to authenticated;

-- catalog.candle_timestamps
alter table catalog.candle_timestamps enable row level security;
drop policy if exists candle_timestamps_select_all on catalog.candle_timestamps;
create policy candle_timestamps_select_all on catalog.candle_timestamps
  for select to authenticated using (true);
grant select on catalog.candle_timestamps to authenticated;
