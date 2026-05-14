-- Standard fields + auto-name (WAB-{0000}) for trading.wallet_asset_balance.
-- Adds `created_at` (table only had `updated_at` previously). created_by has no clean
-- source on this aggregate; leave nullable.

alter table trading.wallet_asset_balance
  add column if not exists name       text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

create sequence if not exists trading.wallet_asset_balance_name_seq;

create or replace function trading.set_wallet_asset_balance_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name('WAB-', 4, nextval('trading.wallet_asset_balance_name_seq'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wallet_asset_balance_auto_name on trading.wallet_asset_balance;
create trigger trg_wallet_asset_balance_auto_name
  before insert on trading.wallet_asset_balance
  for each row execute function trading.set_wallet_asset_balance_auto_name();

drop trigger if exists trg_wallet_asset_balance_set_updated_at on trading.wallet_asset_balance;
create trigger trg_wallet_asset_balance_set_updated_at
  before update on trading.wallet_asset_balance
  for each row execute function public.set_updated_at_now();

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from trading.wallet_asset_balance
   where name is null or name = ''
)
update trading.wallet_asset_balance t
   set name = public.format_auto_name('WAB-', 4, ordered.rn)
  from ordered
 where t.id = ordered.id;

select setval(
  'trading.wallet_asset_balance_name_seq',
  greatest((select count(*)::bigint from trading.wallet_asset_balance), 1)
);

alter table trading.wallet_asset_balance alter column name set not null;
