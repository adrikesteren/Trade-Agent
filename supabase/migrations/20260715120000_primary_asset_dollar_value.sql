-- Primary fiat on user_preferences; catalog.assets.dollar_value = USD per 1 unit (USD fiat = 1).

alter table catalog.assets
  add column if not exists dollar_value numeric;

comment on column catalog.assets.dollar_value is
  'How many USD one unit of this asset is worth. USD fiat row uses 1. Crypto typically tracks coingecko_price_usd; fiat filled by app sync (Frankfurter etc.).';

-- USD fiat = 1 USD per USD
update catalog.assets a
set dollar_value = 1
where a.kind = 'fiat'::public.asset_kind
  and upper(trim(a.code)) = 'USD';

-- Crypto: mirror live CoinGecko USD price where present
update catalog.assets a
set dollar_value = a.coingecko_price_usd
where a.kind = 'crypto'::public.asset_kind
  and a.coingecko_price_usd is not null
  and a.coingecko_price_usd = a.coingecko_price_usd
  and a.coingecko_price_usd > 0;

-- user_preferences.primary_asset_id (fiat only)
alter table public.user_preferences
  add column if not exists primary_asset_id uuid references catalog.assets (id) on delete restrict;

do $$
declare
  v_eur uuid;
begin
  select a.id into v_eur
  from catalog.assets a
  where a.kind = 'fiat'::public.asset_kind
    and upper(trim(a.code)) = 'EUR'
  order by a.created_at asc nulls last
  limit 1;

  if v_eur is null then
    raise exception 'catalog.assets: EUR fiat row required for user_preferences.primary_asset_id backfill';
  end if;

  update public.user_preferences up
  set primary_asset_id = v_eur
  where up.primary_asset_id is null;
end $$;

alter table public.user_preferences
  alter column primary_asset_id set not null;

create index if not exists user_preferences_primary_asset_idx
  on public.user_preferences (primary_asset_id);

-- Enforce primary asset is fiat
create or replace function public.user_preferences_primary_asset_must_be_fiat()
returns trigger
language plpgsql
set search_path = public, catalog
as $$
declare
  k public.asset_kind;
begin
  if new.primary_asset_id is null then
    raise exception 'primary_asset_id is required';
  end if;
  select a.kind into k from catalog.assets a where a.id = new.primary_asset_id;
  if k is null then
    raise exception 'primary_asset_id must reference catalog.assets';
  end if;
  if k::text <> 'fiat' then
    raise exception 'primary_asset_id must be a fiat catalog asset';
  end if;
  return new;
end;
$$;

drop trigger if exists user_preferences_primary_asset_fiat_chk on public.user_preferences;
create trigger user_preferences_primary_asset_fiat_chk
  before insert or update of primary_asset_id on public.user_preferences
  for each row
  execute procedure public.user_preferences_primary_asset_must_be_fiat();

revoke all on function public.user_preferences_primary_asset_must_be_fiat() from public;

-- New auth users: include primary_asset_id (EUR default)
create or replace function public.ensure_user_preferences_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, catalog
as $$
declare
  v_eur uuid;
begin
  select a.id into v_eur
  from catalog.assets a
  where a.kind = 'fiat'::public.asset_kind
    and upper(trim(a.code)) = 'EUR'
  order by a.created_at asc nulls last
  limit 1;

  if v_eur is null then
    raise exception 'catalog.assets: EUR fiat row required for new user_preferences';
  end if;

  insert into public.user_preferences (user_id, primary_asset_id)
  values (new.id, v_eur)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
