-- Terminal state when a new automated run is not started because the same job_key already has a running row.

alter type public.bitvavo_sync_job_status add value if not exists 'skipped';

comment on type public.bitvavo_sync_job_status is 'sync_runs.status: running | completed | failed | skipped';
