-- `ended_at` already marks terminal time for completed/failed/skipped; `completed_at` is redundant.

alter table automation.sync_runs drop column if exists completed_at;
