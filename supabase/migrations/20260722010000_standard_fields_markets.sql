-- Standard fields + formula-name trigger for catalog.markets.
--
-- `name` is derived from the joined base/quote asset codes: `<base.code>-<quote.code>`.
-- The trigger runs BEFORE INSERT and BEFORE UPDATE OF base_asset_id/quote_asset_id (alias
-- `asset_id` is the historical column for the base leg) so the value is always consistent.

alter table catalog.markets
  add column if not exists name        text,
  add column if not exists created_by  uuid references auth.users(id),
  add column if not exists updated_by  uuid references auth.users(id),
  add column if not exists updated_at  timestamptz not null default now();

create or replace function catalog.set_markets_name()
returns trigger
language plpgsql
security definer
set search_path = catalog, public
as $$
declare
  v_base_code  text;
  v_quote_code text;
begin
  select code into v_base_code  from catalog.assets where id = new.asset_id;
  select code into v_quote_code from catalog.assets where id = new.quote_asset_id;
  new.name := coalesce(nullif(trim(v_base_code), ''), '?')
              || '-'
              || coalesce(nullif(trim(v_quote_code), ''), '?');
  return new;
end;
$$;

revoke all on function catalog.set_markets_name() from public;
grant execute on function catalog.set_markets_name() to authenticated, service_role;

drop trigger if exists trg_markets_set_name on catalog.markets;
create trigger trg_markets_set_name
  before insert or update of asset_id, quote_asset_id
  on catalog.markets
  for each row
  execute function catalog.set_markets_name();

drop trigger if exists trg_markets_set_updated_at on catalog.markets;
create trigger trg_markets_set_updated_at
  before update on catalog.markets
  for each row
  execute function public.set_updated_at_now();

-- Backfill name from base + quote asset codes.
update catalog.markets m
   set name = coalesce(nullif(trim(a.code), ''), '?')
              || '-'
              || coalesce(nullif(trim(q.code), ''), '?')
  from catalog.assets a, catalog.assets q
 where m.asset_id = a.id and m.quote_asset_id = q.id;

alter table catalog.markets alter column name set not null;
