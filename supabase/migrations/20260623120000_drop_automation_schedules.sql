-- Remove automation.schedules / automation.schedule_runs (feature removed from app).

drop policy if exists schedule_runs_select_own on automation.schedule_runs;
drop policy if exists schedules_select_own on automation.schedules;
drop policy if exists schedules_insert_own on automation.schedules;
drop policy if exists schedules_update_own on automation.schedules;
drop policy if exists schedules_delete_own on automation.schedules;

drop table if exists automation.schedule_runs;
drop table if exists automation.schedules;
