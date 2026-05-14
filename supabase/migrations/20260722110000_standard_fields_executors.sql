-- Standard fields for trading.executors (manual name; already has `name` not null + check).

alter table trading.executors
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

drop trigger if exists trg_executors_set_updated_at on trading.executors;
create trigger trg_executors_set_updated_at
  before update on trading.executors
  for each row execute function public.set_updated_at_now();

update trading.executors set created_by = user_id where created_by is null;
