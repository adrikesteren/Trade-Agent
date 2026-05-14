-- Widen SELECT on automation.* user-scoped tables (schedules + schedule_runs) so:
--   * users can read their own rows,
--   * any authenticated user can read rows owned by the automation user,
--   * the automation user (when signed in) can read every row.
--
-- automation.sync_runs / signal_jobs / signal_runs already allow SELECT to all
-- authenticated users (`using (true)`); no change needed.

drop policy if exists schedules_select_own on automation.schedules;
create policy schedules_select_own on automation.schedules
  for select to authenticated
  using (public.row_owner_visible(user_id));

drop policy if exists schedule_runs_select_own on automation.schedule_runs;
create policy schedule_runs_select_own on automation.schedule_runs
  for select to authenticated
  using (
    exists (
      select 1
      from automation.schedules s
      where s.id = schedule_runs.schedule_id
        and public.row_owner_visible(s.user_id)
    )
  );
