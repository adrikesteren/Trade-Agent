-- Live dashboard: Supabase Realtime on automation.sync_runs (authenticated SELECT via RLS).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and pt.schemaname = 'automation'
      and pt.tablename = 'sync_runs'
  ) then
    alter publication supabase_realtime add table automation.sync_runs;
  end if;
end $$;
