-- automation.signal_jobs / automation.signal_runs were created *after* the split migration ran
-- `grant select on all tables in schema automation to authenticated`, so they never received
-- table privileges → PostgREST: "permission denied for table signal_jobs" / signal_runs.
--
-- Align with trading (20260615120000): blanket grants + default privileges for future tables.

grant select, insert, update, delete on all tables in schema automation to authenticated;
grant all on all tables in schema automation to service_role;

alter default privileges for role postgres in schema automation
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema automation
  grant all on tables to service_role;
