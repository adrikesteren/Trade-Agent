-- bitvavo_sync_status: job lifecycle (running / completed), created_at, completed_at (replaces last_success_at).

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'bitvavo_sync_job_status'
      and n.nspname = 'public'
  ) then
    create type public.bitvavo_sync_job_status as enum ('running', 'completed');
  end if;
end $$;

alter table public.bitvavo_sync_status
  add column if not exists status public.bitvavo_sync_job_status,
  add column if not exists created_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.bitvavo_sync_status
set
  status = 'completed'::public.bitvavo_sync_job_status,
  created_at = coalesce(created_at, last_success_at),
  completed_at = coalesce(completed_at, last_success_at);

alter table public.bitvavo_sync_status
  drop column if exists last_success_at;

alter table public.bitvavo_sync_status
  alter column status set default 'completed'::public.bitvavo_sync_job_status;

alter table public.bitvavo_sync_status
  alter column status set not null;

alter table public.bitvavo_sync_status
  alter column created_at set default now();

update public.bitvavo_sync_status
set created_at = now()
where created_at is null;

alter table public.bitvavo_sync_status
  alter column created_at set not null;
