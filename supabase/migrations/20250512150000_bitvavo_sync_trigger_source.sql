do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'bitvavo_sync_trigger_source'
      and n.nspname = 'public'
  ) then
    create type public.bitvavo_sync_trigger_source as enum ('manual', 'automated');
  end if;
end $$;

alter table public.bitvavo_sync_status
  add column if not exists last_trigger_source public.bitvavo_sync_trigger_source not null default 'automated',
  add column if not exists last_automated_success_at timestamptz;

update public.bitvavo_sync_status
set
  last_trigger_source = coalesce(last_trigger_source, 'automated'),
  last_automated_success_at = coalesce(last_automated_success_at, last_success_at);
