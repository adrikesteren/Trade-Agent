-- Generalize table name: Bitvavo jobs remain job_key values; table holds any append-only sync run.

alter table public.bitvavo_sync_runs rename to sync_runs;

alter index public.bitvavo_sync_runs_job_created_idx rename to sync_runs_job_created_idx;
alter index public.bitvavo_sync_runs_job_status_idx rename to sync_runs_job_status_idx;

drop policy if exists bitvavo_sync_runs_select_authenticated on public.sync_runs;

create policy sync_runs_select_authenticated
  on public.sync_runs
  for select
  to authenticated
  using (true);

comment on table public.sync_runs is 'Append-only sync attempts per job_key (e.g. Bitvavo markets/candles EUR); one row per run.';
