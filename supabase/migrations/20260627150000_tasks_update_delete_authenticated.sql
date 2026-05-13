-- Align UPDATE/DELETE with broadened SELECT (20260627100200): any signed-in user may resolve catalog tasks
-- created under `automated_process` from the dashboard (previously visible but not updatable).

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (true);
