-- Standard fields for public.tasks (manual name; backfill from `title`).
-- `title` stays as the canonical user-facing column; `name` is added for AdriCore contract
-- compatibility and kept in sync via an after-write trigger so the two cannot drift.

alter table public.tasks
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

-- Backfill name from title for existing rows.
update public.tasks set name = title where (name is null or name = '') and title is not null;

-- Keep name <- title in sync without forcing callers to update both.
create or replace function public.set_tasks_name_from_title()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := new.title;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_set_name on public.tasks;
create trigger trg_tasks_set_name
  before insert or update of title, name on public.tasks
  for each row execute function public.set_tasks_name_from_title();

drop trigger if exists trg_tasks_set_updated_at on public.tasks;
create trigger trg_tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at_now();

alter table public.tasks alter column name set not null;

update public.tasks set created_by = user_id where created_by is null;
