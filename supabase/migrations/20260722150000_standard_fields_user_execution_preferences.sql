-- Standard fields + auto-name (UEP-{0000}) for trading.user_execution_preferences.
-- Was a singleton with `user_id uuid primary key`. Rebuild with `id uuid` PK +
-- UNIQUE(user_id). No incoming FKs.

alter table trading.user_execution_preferences
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'trading.user_execution_preferences'::regclass
       and conname  = 'user_execution_preferences_pkey'
  ) then
    alter table trading.user_execution_preferences drop constraint user_execution_preferences_pkey;
  end if;
end $$;

alter table trading.user_execution_preferences
  add constraint user_execution_preferences_user_id_key unique (user_id);

alter table trading.user_execution_preferences
  add constraint user_execution_preferences_pkey primary key (id);

create sequence if not exists trading.user_execution_preferences_name_seq;

create or replace function trading.set_user_execution_preferences_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('UEP-', 4, nextval('trading.user_execution_preferences_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_execution_preferences_auto_name on trading.user_execution_preferences;
create trigger trg_user_execution_preferences_auto_name
  before insert on trading.user_execution_preferences
  for each row execute function trading.set_user_execution_preferences_auto_name();

drop trigger if exists trg_user_execution_preferences_set_updated_at on trading.user_execution_preferences;
create trigger trg_user_execution_preferences_set_updated_at
  before update on trading.user_execution_preferences
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.user_execution_preferences
   where name is null or name = ''
)
update trading.user_execution_preferences t
   set name = public.format_auto_name('UEP-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.user_execution_preferences_name_seq',
  greatest((select count(*)::bigint from trading.user_execution_preferences), 1)
);

alter table trading.user_execution_preferences alter column name set not null;

update trading.user_execution_preferences set created_by = user_id where created_by is null;
