-- Standard fields for catalog.exchanges (manual name; already has `name` text not null).

alter table catalog.exchanges
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_exchanges_set_updated_at on catalog.exchanges;
create trigger trg_exchanges_set_updated_at
  before update on catalog.exchanges
  for each row execute function public.set_updated_at_now();
