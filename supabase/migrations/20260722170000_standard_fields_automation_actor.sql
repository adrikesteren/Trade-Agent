-- Standard fields + auto-name (AAC-{0000}) for public.automation_actor.
-- Was a singleton with `key text primary key`. Rebuild with `id uuid` PK + UNIQUE(key).
-- user_id remains a NOT NULL unique FK to auth.users (the automated process user). No
-- incoming FKs.

alter table public.automation_actor
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.automation_actor'::regclass
       and conname  = 'automation_actor_pkey'
  ) then
    alter table public.automation_actor drop constraint automation_actor_pkey;
  end if;
end $$;

alter table public.automation_actor
  add constraint automation_actor_key_key unique (key);

alter table public.automation_actor
  add constraint automation_actor_pkey primary key (id);

create sequence if not exists public.automation_actor_name_seq;

create or replace function public.set_automation_actor_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('AAC-', 4, nextval('public.automation_actor_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_automation_actor_auto_name on public.automation_actor;
create trigger trg_automation_actor_auto_name
  before insert on public.automation_actor
  for each row execute function public.set_automation_actor_auto_name();

drop trigger if exists trg_automation_actor_set_updated_at on public.automation_actor;
create trigger trg_automation_actor_set_updated_at
  before update on public.automation_actor
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from public.automation_actor
   where name is null or name = ''
)
update public.automation_actor t
   set name = public.format_auto_name('AAC-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'public.automation_actor_name_seq',
  greatest((select count(*)::bigint from public.automation_actor), 1)
);

alter table public.automation_actor alter column name set not null;
