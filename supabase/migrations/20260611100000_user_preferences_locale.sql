-- Per-user UI display preferences (timezone, date/time/decimal formatting). Lives in public — not trading domain.

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_timezone') then
    create type public.user_timezone as enum (
      'europe_amsterdam',
      'utc',
      'europe_london',
      'europe_berlin',
      'america_new_york',
      'america_los_angeles',
      'asia_tokyo',
      'australia_sydney'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_decimal_format') then
    create type public.user_decimal_format as enum (
      'comma_decimal',
      'period_decimal',
      'apostrophe_decimal'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_date_format') then
    create type public.user_date_format as enum ('dmy', 'mdy', 'ymd');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_time_format') then
    create type public.user_time_format as enum ('h24', 'h12');
  end if;
end $$;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone public.user_timezone not null default 'europe_amsterdam',
  decimal_format public.user_decimal_format not null default 'comma_decimal',
  date_format public.user_date_format not null default 'dmy',
  time_format public.user_time_format not null default 'h24',
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_updated_idx on public.user_preferences (updated_at desc);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_preferences_insert on public.user_preferences;
create policy user_preferences_insert on public.user_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_update on public.user_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

-- Existing users: Amsterdam-style defaults (same as column defaults).
insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- New auth users: ensure a preferences row exists.
create or replace function public.ensure_user_preferences_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_user_preferences on auth.users;
create trigger on_auth_user_created_user_preferences
  after insert on auth.users
  for each row execute procedure public.ensure_user_preferences_for_new_user();

revoke all on function public.ensure_user_preferences_for_new_user() from public;
