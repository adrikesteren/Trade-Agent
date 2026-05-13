-- Stable automation actor (auth user) + user_profiles.username (NOT NULL UNIQUE) + public.automation_actor.

-- 1) Username column (nullable until backfilled)
alter table public.user_profiles
  add column if not exists username text;

-- 2) Backfill existing profiles with unique random usernames
update public.user_profiles
set username = gen_random_uuid()::text
where username is null;

-- 3) New signups: always assign a unique username (uuid text) until user picks a handle (future UI)
create or replace function public.ensure_user_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, username)
  values (new.id, gen_random_uuid()::text)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 4) System user: fixed id for stable references in migrations / docs
--    instance_id matches local Supabase default; email is non-routable.
do $$
declare
  v_uid uuid := 'c0ffee00-c0ff-c0ff-c0ff-eeee00000001'::uuid;
  v_instance uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_now timestamptz := now();
  v_pw text;
begin
  if exists (select 1 from auth.users where id = v_uid) then
    return;
  end if;

  v_pw := crypt('automated-process-no-login', gen_salt('bf'));

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    reauthentication_token,
    is_sso_user,
    is_anonymous
  ) values (
    v_instance,
    v_uid,
    'authenticated',
    'authenticated',
    'automated-process@system.invalid',
    v_pw,
    v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Automated Process"}'::jsonb,
    v_now,
    v_now,
    '',
    '',
    '',
    '',
    '',
    '',
    false,
    false
  );

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_uid::text,
    v_uid,
    jsonb_build_object(
      'sub', v_uid::text,
      'email', 'automated-process@system.invalid',
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    v_now,
    v_now,
    v_now
  );

  update public.user_profiles
  set username = 'automated_process'
  where user_id = v_uid;
end $$;

-- 5) Enforce NOT NULL + UNIQUE on username
alter table public.user_profiles
  alter column username set not null;

create unique index if not exists user_profiles_username_lower_uidx
  on public.user_profiles (lower(username));

-- 6) Registrar table (service role + optional authenticated read for debugging)
create table if not exists public.automation_actor (
  key text primary key,
  user_id uuid not null unique references auth.users (id) on delete restrict
);

insert into public.automation_actor (key, user_id)
values ('automated_process', 'c0ffee00-c0ff-c0ff-c0ff-eeee00000001'::uuid)
on conflict (key) do update set user_id = excluded.user_id;

alter table public.automation_actor enable row level security;

drop policy if exists automation_actor_select_own on public.automation_actor;
create policy automation_actor_select_own on public.automation_actor
  for select to authenticated using (true);

grant select on table public.automation_actor to authenticated;
grant all on table public.automation_actor to service_role;
