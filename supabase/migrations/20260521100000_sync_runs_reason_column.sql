-- Rename failed_reason -> reason; require reason for failed and skipped.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'automation'
      and table_name = 'sync_runs'
      and column_name = 'failed_reason'
  ) then
    alter table automation.sync_runs rename column failed_reason to reason;
  end if;
end $$;

update automation.sync_runs
set reason = coalesce(nullif(trim(reason), ''), 'Legacy: not recorded')
where status = 'failed'
  and (reason is null or trim(reason) = '');

update automation.sync_runs
set reason = coalesce(nullif(trim(reason), ''), 'Previous sync still running')
where status = 'skipped'
  and (reason is null or trim(reason) = '');

alter table automation.sync_runs drop constraint if exists sync_runs_failed_reason_when_failed;

alter table automation.sync_runs
  add constraint sync_runs_reason_when_failed_or_skipped
    check (status not in ('failed', 'skipped') or (reason is not null and trim(reason) <> ''));

comment on column automation.sync_runs.reason is 'Required when status is failed or skipped; human-readable message.';
