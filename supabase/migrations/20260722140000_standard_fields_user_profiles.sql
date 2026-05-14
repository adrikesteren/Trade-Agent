-- Standard fields + auto-name (UPF-{0000}) for public.user_profiles.
-- Was a singleton with `user_id uuid primary key`. Rebuild with `id uuid` PK +
-- UNIQUE(user_id). No incoming FKs.

alter table public.user_profiles
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_profiles'::regclass
       and conname  = 'user_profiles_pkey'
  ) then
    alter table public.user_profiles drop constraint user_profiles_pkey;
  end if;
end $$;

alter table public.user_profiles
  add constraint user_profiles_user_id_key unique (user_id);

alter table public.user_profiles
  add constraint user_profiles_pkey primary key (id);

create sequence if not exists public.user_profiles_name_seq;

create or replace function public.set_user_profiles_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('UPF-', 4, nextval('public.user_profiles_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_auto_name on public.user_profiles;
create trigger trg_user_profiles_auto_name
  before insert on public.user_profiles
  for each row execute function public.set_user_profiles_auto_name();

drop trigger if exists trg_user_profiles_set_updated_at on public.user_profiles;
create trigger trg_user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from public.user_profiles
   where name is null or name = ''
)
update public.user_profiles t
   set name = public.format_auto_name('UPF-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'public.user_profiles_name_seq',
  greatest((select count(*)::bigint from public.user_profiles), 1)
);

alter table public.user_profiles alter column name set not null;

update public.user_profiles set created_by = user_id where created_by is null;
