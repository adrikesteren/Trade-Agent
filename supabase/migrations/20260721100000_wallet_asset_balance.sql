-- Materialized per-(wallet, asset) balance + link from each wallet_transaction to the updated balance row.

-- ---------------------------------------------------------------------------
-- 1) Aggregate table
-- ---------------------------------------------------------------------------
create table if not exists trading.wallet_asset_balance (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references trading.wallets (id) on delete cascade,
  asset_id uuid not null references catalog.assets (id) on delete restrict,
  amount numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint wallet_asset_balance_amount_finite check (amount = amount),
  constraint wallet_asset_balance_wallet_asset_uidx unique (wallet_id, asset_id)
);

create index if not exists wallet_asset_balance_wallet_idx
  on trading.wallet_asset_balance (wallet_id, updated_at desc);

comment on table trading.wallet_asset_balance is
  'Running quantity per wallet + catalog asset; kept in sync on wallet_transaction insert (quantity is signed).';

comment on column trading.wallet_asset_balance.amount is
  'Sum of wallet_transactions.quantity for this wallet_id + asset_id.';

-- ---------------------------------------------------------------------------
-- 2) FK from ledger rows to the balance row they updated
-- ---------------------------------------------------------------------------
alter table trading.wallet_transactions
  add column if not exists wallet_asset_balance_id uuid references trading.wallet_asset_balance (id) on delete set null;

create index if not exists wallet_transactions_wallet_asset_balance_idx
  on trading.wallet_transactions (wallet_asset_balance_id)
  where wallet_asset_balance_id is not null;

comment on column trading.wallet_transactions.wallet_asset_balance_id is
  'wallet_asset_balance row whose amount reflects this transaction being applied.';

-- ---------------------------------------------------------------------------
-- 3) Backfill from existing transactions
-- ---------------------------------------------------------------------------
insert into trading.wallet_asset_balance (wallet_id, asset_id, amount)
select wt.wallet_id, wt.asset_id, coalesce(sum(wt.quantity), 0)
from trading.wallet_transactions wt
group by wt.wallet_id, wt.asset_id
on conflict (wallet_id, asset_id) do update set
  amount = excluded.amount,
  updated_at = now();

update trading.wallet_transactions wt
set wallet_asset_balance_id = bab.id
from trading.wallet_asset_balance bab
where bab.wallet_id = wt.wallet_id
  and bab.asset_id = wt.asset_id;

-- ---------------------------------------------------------------------------
-- 4) Trigger: new transaction bumps balance + stores pointer
-- ---------------------------------------------------------------------------
create or replace function trading.trg_wallet_transactions_touch_wallet_asset_balance()
returns trigger
language plpgsql
security definer
set search_path = trading, public
as $$
declare
  v_balance_id uuid;
begin
  insert into trading.wallet_asset_balance (wallet_id, asset_id, amount)
  values (new.wallet_id, new.asset_id, new.quantity)
  on conflict (wallet_id, asset_id) do update set
    amount = wallet_asset_balance.amount + excluded.amount,
    updated_at = now()
  returning id into v_balance_id;

  update trading.wallet_transactions
  set wallet_asset_balance_id = v_balance_id
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists wallet_transactions_touch_wallet_asset_balance on trading.wallet_transactions;
create trigger wallet_transactions_touch_wallet_asset_balance
  after insert on trading.wallet_transactions
  for each row
  execute procedure trading.trg_wallet_transactions_touch_wallet_asset_balance();

revoke all on function trading.trg_wallet_transactions_touch_wallet_asset_balance() from public;

-- ---------------------------------------------------------------------------
-- 5) RLS (match wallet ownership via executors)
-- ---------------------------------------------------------------------------
alter table trading.wallet_asset_balance enable row level security;

drop policy if exists wallet_asset_balance_select on trading.wallet_asset_balance;
create policy wallet_asset_balance_select on trading.wallet_asset_balance
  for select to authenticated
  using (
    exists (
      select 1
      from trading.wallets w
      join trading.executors e on e.id = w.executor_id
      where w.id = wallet_asset_balance.wallet_id
        and e.user_id = auth.uid()
    )
  );

grant select on trading.wallet_asset_balance to authenticated;
grant all on trading.wallet_asset_balance to service_role;
