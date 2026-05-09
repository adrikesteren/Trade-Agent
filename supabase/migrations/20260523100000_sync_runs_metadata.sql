-- Per-run structured details (job-specific shape); merged by app on updates.

alter table automation.sync_runs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column automation.sync_runs.metadata is 'Optional job-specific JSON (counts, offsets, etc.); merged on worker updates.';
