-- Append-only application logs per user (errors, info, etc.).

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  level text not null default 'info',
  message text not null,
  context text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint logs_level_check check (level in ('debug', 'info', 'warn', 'error'))
);

create index if not exists logs_user_created_idx on public.logs (user_id, created_at desc);

alter table public.logs enable row level security;

drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_dashboard_administrator());

drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_dashboard_administrator());

grant select, insert on public.logs to authenticated;
grant all on public.logs to service_role;
