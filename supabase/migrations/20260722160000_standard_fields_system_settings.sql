-- Standard fields + auto-name (SYS-{0000}) for public.system_settings.
-- Was a singleton with `key text primary key`. Rebuild with `id uuid` PK + UNIQUE(key).
-- No incoming FKs.

alter table public.system_settings
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.system_settings'::regclass
       and conname  = 'system_settings_pkey'
  ) then
    alter table public.system_settings drop constraint system_settings_pkey;
  end if;
end $$;

alter table public.system_settings
  add constraint system_settings_key_key unique (key);

alter table public.system_settings
  add constraint system_settings_pkey primary key (id);

create sequence if not exists public.system_settings_name_seq;

create or replace function public.set_system_settings_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('SYS-', 4, nextval('public.system_settings_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_system_settings_auto_name on public.system_settings;
create trigger trg_system_settings_auto_name
  before insert on public.system_settings
  for each row execute function public.set_system_settings_auto_name();

drop trigger if exists trg_system_settings_set_updated_at on public.system_settings;
create trigger trg_system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from public.system_settings
   where name is null or name = ''
)
update public.system_settings t
   set name = public.format_auto_name('SYS-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'public.system_settings_name_seq',
  greatest((select count(*)::bigint from public.system_settings), 1)
);

alter table public.system_settings alter column name set not null;
