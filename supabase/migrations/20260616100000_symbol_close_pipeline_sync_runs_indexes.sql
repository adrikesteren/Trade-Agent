-- Allow parallel in-flight `symbol_close_pipeline` runs per (assetCode, exchangeCode) in metadata,
-- while keeping at most one running row per job_key for all other jobs.

drop index if exists automation.sync_runs_one_running_per_job_key;

create unique index sync_runs_one_running_per_job_key_general
  on automation.sync_runs (job_key)
  where (status = 'running'::public.bitvavo_sync_job_status)
    and (job_key is distinct from 'symbol_close_pipeline');

create unique index sync_runs_one_running_symbol_close_pipeline_scope
  on automation.sync_runs (
    job_key,
    lower(metadata ->> 'assetCode'),
    lower(metadata ->> 'exchangeCode')
  )
  where (status = 'running'::public.bitvavo_sync_job_status)
    and job_key = 'symbol_close_pipeline'
    and (metadata ? 'assetCode')
    and (metadata ? 'exchangeCode');

comment on index automation.sync_runs_one_running_per_job_key_general is
  'At most one running sync_runs row per job_key for jobs other than symbol_close_pipeline.';

comment on index automation.sync_runs_one_running_symbol_close_pipeline_scope is
  'At most one running symbol_close_pipeline per normalized assetCode + exchangeCode (metadata).';
