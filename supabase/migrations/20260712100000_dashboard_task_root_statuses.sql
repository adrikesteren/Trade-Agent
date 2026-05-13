-- Distinct root-task statuses for dashboard filter (avoids loading every row client-side).

create or replace function public.dashboard_task_root_statuses()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct t.status
  from public.tasks t
  where t.parent_task_id is null
  order by 1;
$$;

revoke all on function public.dashboard_task_root_statuses() from public;
grant execute on function public.dashboard_task_root_statuses() to authenticated;
grant execute on function public.dashboard_task_root_statuses() to service_role;
