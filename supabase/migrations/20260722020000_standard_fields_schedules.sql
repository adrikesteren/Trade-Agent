-- Standard fields + auto-name (SCH-{0000}) for automation.schedules.
-- `name`/`created_at`/`updated_at` already exist; we add the audit FK columns,
-- the per-table sequence, the BEFORE INSERT auto-name trigger (only fills `name`
-- when the caller did not supply one — existing rows keep their human-supplied
-- names), and the BEFORE UPDATE updated_at trigger.

alter table automation.schedules
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

create sequence if not exists automation.schedules_name_seq;

create or replace function automation.set_schedules_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('SCH-', 4, nextval('automation.schedules_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schedules_auto_name on automation.schedules;
create trigger trg_schedules_auto_name
  before insert on automation.schedules
  for each row execute function automation.set_schedules_auto_name();

drop trigger if exists trg_schedules_set_updated_at on automation.schedules;
create trigger trg_schedules_set_updated_at
  before update on automation.schedules
  for each row execute function public.set_updated_at_now();

-- Existing schedule rows keep their user-supplied names. Only bump the sequence so future
-- auto-named rows do not collide with hypothetical legacy names like 'SCH-0001'.
select setval(
  'automation.schedules_name_seq',
  greatest(
    (select count(*)::bigint from automation.schedules where name like 'SCH-%'),
    1
  )
);
