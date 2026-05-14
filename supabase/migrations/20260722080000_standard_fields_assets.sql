-- Standard fields for catalog.assets (manual name; already has `name` text nullable).
-- Catalog assets sometimes have null names from upstream catalog feeds, so we do NOT
-- enforce NOT NULL here; the manual `nameField` contract permits human-edited rows.

alter table catalog.assets
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_assets_set_updated_at on catalog.assets;
create trigger trg_assets_set_updated_at
  before update on catalog.assets
  for each row execute function public.set_updated_at_now();
