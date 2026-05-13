-- Salesforce-style tasks (polymorphic parent + optional subtasks).

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  priority text,
  due_at timestamptz,
  related_schema text not null,
  related_table text not null,
  related_id uuid not null,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  task_type text not null,
  job_identifier text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_related_idx on public.tasks (related_schema, related_table, related_id);
create index if not exists tasks_parent_idx on public.tasks (parent_task_id);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists tasks_created_idx on public.tasks (created_at desc);

-- At most one open "manual CoinGecko" skip task per catalog asset
create unique index if not exists tasks_one_open_coingecko_asset_uidx
  on public.tasks (related_schema, related_table, related_id)
  where status = 'open'
    and task_type = 'requires_manual_coingecko_search'
    and job_identifier = 'skip_auto_coingecko_coin_id';

alter table public.tasks enable row level security;

-- Helper: dashboard administrators (same notion as public.system_settings)
create or replace function public.is_dashboard_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.role = 'administrator'::public.app_user_role
  );
$$;

revoke all on function public.is_dashboard_administrator() from public;
grant execute on function public.is_dashboard_administrator() to authenticated;
grant execute on function public.is_dashboard_administrator() to service_role;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (user_id = auth.uid() or public.is_dashboard_administrator());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_dashboard_administrator());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (user_id = auth.uid() or public.is_dashboard_administrator())
  with check (user_id = auth.uid() or public.is_dashboard_administrator());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (user_id = auth.uid() or public.is_dashboard_administrator());

grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
