-- One row per sync cycle (append-only). Replaces singleton bitvavo_sync_status.

create table public.bitvavo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null,
  status public.bitvavo_sync_job_status not null,
  trigger_source public.bitvavo_sync_trigger_source not null default 'automated',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index bitvavo_sync_runs_job_created_idx on public.bitvavo_sync_runs (job_key, created_at desc);
create index bitvavo_sync_runs_job_status_idx on public.bitvavo_sync_runs (job_key, status);

comment on table public.bitvavo_sync_runs is 'Append-only Bitvavo catalog/candle sync attempts (one row per run).';

alter table public.bitvavo_sync_runs enable row level security;

create policy bitvavo_sync_runs_select_authenticated
  on public.bitvavo_sync_runs
  for select
  to authenticated
  using (true);

-- Copy legacy singleton rows as historical runs, then drop old table.
insert into public.bitvavo_sync_runs (
  job_key,
  status,
  trigger_source,
  created_at,
  completed_at,
  ended_at,
  updated_at
)
select
  s.job_key,
  s.status,
  s.last_trigger_source,
  s.created_at,
  case when s.status = 'completed'::public.bitvavo_sync_job_status then s.completed_at else null end,
  case
    when s.status = 'completed'::public.bitvavo_sync_job_status then coalesce(s.completed_at, s.updated_at)
    when s.status = 'failed'::public.bitvavo_sync_job_status then s.updated_at
    else null
  end,
  s.updated_at
from public.bitvavo_sync_status s;

drop policy if exists bitvavo_sync_status_select_authenticated on public.bitvavo_sync_status;

drop table public.bitvavo_sync_status;
