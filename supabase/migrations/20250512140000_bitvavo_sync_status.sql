-- Last successful Bitvavo catalog sync times (markets + candles). Updated by API routes (service role).
-- Authenticated users may read for dashboard UI.

create table public.bitvavo_sync_status (
  job_key text primary key,
  last_success_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index bitvavo_sync_status_updated_idx on public.bitvavo_sync_status (updated_at desc);

alter table public.bitvavo_sync_status enable row level security;

create policy bitvavo_sync_status_select_authenticated
  on public.bitvavo_sync_status
  for select
  to authenticated
  using (true);
