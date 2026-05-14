-- Re-create automation.schedules / automation.schedule_runs after
-- 20260623120000_drop_automation_schedules.sql (feature is back / metadata needs them).
-- Baseline DDL matches 20260621130000; RLS is own-row only here.
-- 20260722190300 widens SELECT to public.row_owner_visible.

create table if not exists automation.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  cron_expression text,
  worker_path text,
  payload jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedules_user_created_idx
  on automation.schedules (user_id, created_at desc);

create table if not exists automation.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references automation.schedules (id) on delete cascade,
  status text not null default 'pending',
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists schedule_runs_schedule_created_idx
  on automation.schedule_runs (schedule_id, created_at desc);

alter table automation.schedules enable row level security;
alter table automation.schedule_runs enable row level security;

drop policy if exists schedules_select_own on automation.schedules;
create policy schedules_select_own on automation.schedules
  for select to authenticated using (user_id = auth.uid());

drop policy if exists schedules_insert_own on automation.schedules;
create policy schedules_insert_own on automation.schedules
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists schedules_update_own on automation.schedules;
create policy schedules_update_own on automation.schedules
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists schedules_delete_own on automation.schedules;
create policy schedules_delete_own on automation.schedules
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists schedule_runs_select_own on automation.schedule_runs;
create policy schedule_runs_select_own on automation.schedule_runs
  for select to authenticated using (
    exists (
      select 1
      from automation.schedules s
      where s.id = schedule_runs.schedule_id
        and s.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on automation.schedules to authenticated;
grant select on automation.schedule_runs to authenticated;
