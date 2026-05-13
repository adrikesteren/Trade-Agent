-- Broaden task read access: catalog-close tasks are owned by `automated_process` but must be visible to any signed-in user on related record pages.

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (true);
