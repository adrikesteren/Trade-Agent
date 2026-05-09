-- At most one in-flight run per job_key (prevents overlapping candle sweeps without a race window).

create unique index if not exists sync_runs_one_running_per_job_key
  on automation.sync_runs (job_key)
  where (status = 'running'::public.bitvavo_sync_job_status);

comment on index automation.sync_runs_one_running_per_job_key is
  'Ensures only one sync_runs row per job_key can be running at a time; concurrent starts get a unique violation.';
