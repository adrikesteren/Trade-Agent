-- Dashboard role (Administrator vs User) for gated features such as public.system_settings.

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'app_user_role') then
    create type public.app_user_role as enum ('user', 'administrator');
  end if;
end $$;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_user_role not null default 'user',
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_updated_idx on public.user_profiles (updated_at desc);

alter table public.user_profiles enable row level security;

-- Users may read their own profile (admin check in the app). No client-side role changes.
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated using (auth.uid() = user_id);

grant select on public.user_profiles to authenticated;
grant all on public.user_profiles to service_role;

-- Existing auth users: default role user.
insert into public.user_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.ensure_user_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_user_profiles on auth.users;
create trigger on_auth_user_created_user_profiles
  after insert on auth.users
  for each row execute procedure public.ensure_user_profile_for_new_user();

revoke all on function public.ensure_user_profile_for_new_user() from public;
