-- Fiat catalog assets + markets.quote_asset_id (backfill from quote_code).
-- Enum label `fiat` is added in 20260701095000_catalog_asset_kind_add_fiat.sql (separate txn).
-- Keep fiat ISO list in sync with apps/web/src/lib/markets/fiat-quote-currency-codes.ts

insert into catalog.assets (kind, code, name, metadata)
values
  ('fiat', 'EUR', 'Euro', '{}'::jsonb),
  ('fiat', 'USD', 'United States dollar', '{}'::jsonb),
  ('fiat', 'GBP', 'British pound', '{}'::jsonb),
  ('fiat', 'CHF', 'Swiss franc', '{}'::jsonb),
  ('fiat', 'NOK', 'Norwegian krone', '{}'::jsonb),
  ('fiat', 'SEK', 'Swedish krona', '{}'::jsonb),
  ('fiat', 'DKK', 'Danish krone', '{}'::jsonb),
  ('fiat', 'PLN', 'Polish złoty', '{}'::jsonb),
  ('fiat', 'CZK', 'Czech koruna', '{}'::jsonb),
  ('fiat', 'HUF', 'Hungarian forint', '{}'::jsonb),
  ('fiat', 'RON', 'Romanian leu', '{}'::jsonb),
  ('fiat', 'BGN', 'Bulgarian lev', '{}'::jsonb),
  ('fiat', 'ISK', 'Icelandic króna', '{}'::jsonb),
  ('fiat', 'TRY', 'Turkish lira', '{}'::jsonb),
  ('fiat', 'JPY', 'Japanese yen', '{}'::jsonb),
  ('fiat', 'CNY', 'Chinese yuan', '{}'::jsonb),
  ('fiat', 'AUD', 'Australian dollar', '{}'::jsonb),
  ('fiat', 'CAD', 'Canadian dollar', '{}'::jsonb),
  ('fiat', 'NZD', 'New Zealand dollar', '{}'::jsonb),
  ('fiat', 'SGD', 'Singapore dollar', '{}'::jsonb),
  ('fiat', 'HKD', 'Hong Kong dollar', '{}'::jsonb),
  ('fiat', 'MXN', 'Mexican peso', '{}'::jsonb),
  ('fiat', 'ZAR', 'South African rand', '{}'::jsonb),
  ('fiat', 'ILS', 'Israeli new shekel', '{}'::jsonb),
  ('fiat', 'INR', 'Indian rupee', '{}'::jsonb),
  ('fiat', 'KRW', 'South Korean won', '{}'::jsonb),
  ('fiat', 'THB', 'Thai baht', '{}'::jsonb),
  ('fiat', 'PHP', 'Philippine peso', '{}'::jsonb),
  ('fiat', 'IDR', 'Indonesian rupiah', '{}'::jsonb),
  ('fiat', 'MYR', 'Malaysian ringgit', '{}'::jsonb)
on conflict (kind, code) do nothing;

alter table catalog.markets
  add column if not exists quote_asset_id uuid references catalog.assets (id) on delete restrict;

-- Prefer fiat row when quote symbol is a seeded fiat ISO code; otherwise match crypto asset code.
update catalog.markets m
set quote_asset_id = a.id
from catalog.assets a
where m.quote_asset_id is null
  and m.quote_code is not null
  and length(trim(m.quote_code)) > 0
  and a.kind = 'fiat'::public.asset_kind
  and a.code = upper(trim(m.quote_code))
  and upper(trim(m.quote_code)) in (
    'EUR', 'USD', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'ISK',
    'TRY', 'JPY', 'CNY', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN', 'ZAR', 'ILS', 'INR', 'KRW',
    'THB', 'PHP', 'IDR', 'MYR'
  );

update catalog.markets m
set quote_asset_id = a.id
from catalog.assets a
where m.quote_asset_id is null
  and m.quote_code is not null
  and length(trim(m.quote_code)) > 0
  and a.kind = 'crypto'::public.asset_kind
  and a.code = upper(trim(m.quote_code))
  and upper(trim(m.quote_code)) not in (
    'EUR', 'USD', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'ISK',
    'TRY', 'JPY', 'CNY', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN', 'ZAR', 'ILS', 'INR', 'KRW',
    'THB', 'PHP', 'IDR', 'MYR'
  );

do $$
declare
  n int;
begin
  select count(*)::int into n from catalog.markets where quote_asset_id is null;
  if n > 0 then
    raise exception 'catalog.markets: % rows still have null quote_asset_id after backfill (fix assets or quote_code)', n;
  end if;
end $$;

alter table catalog.markets alter column quote_asset_id set not null;

create index if not exists markets_quote_asset_idx on catalog.markets (quote_asset_id);

comment on column catalog.markets.quote_asset_id is 'Quote leg of the pair (fiat or crypto asset); spend this asset to buy base (asset_id).';
