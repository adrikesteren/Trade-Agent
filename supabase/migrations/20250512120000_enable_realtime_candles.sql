-- Broadcast INSERT/UPDATE on catalog OHLCV to Supabase Realtime (live charts on market detail).
-- Subscribers still need SELECT via RLS (candles_select_all for authenticated).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and pt.schemaname = 'public'
      and pt.tablename = 'candles'
  ) then
    alter publication supabase_realtime add table public.candles;
  end if;
end $$;
