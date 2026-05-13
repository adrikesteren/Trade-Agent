-- Wallets + wallet_transactions replace executor_balance_ledger + risk_state equity.
-- Runtime risk counters move to trading.executors (risk_* columns).
-- trading.trade_decisions → trading.decisions

-- ---------------------------------------------------------------------------
-- 1) Types + core tables
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'trading' and t.typname = 'wallet_transaction_kind'
  ) then
    create type trading.wallet_transaction_kind as enum (
      'deposit',
      'withdrawal',
      'trade_buy',
      'trade_sell'
    );
  end if;
end $$;

create table if not exists trading.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  executor_id uuid not null references trading.executors (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wallets_executor_uidx unique (executor_id)
);

create index if not exists wallets_user_created_idx
  on trading.wallets (user_id, created_at desc);

create table if not exists trading.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_id uuid not null references trading.wallets (id) on delete cascade,
  asset_id uuid not null references catalog.assets (id) on delete restrict,
  kind trading.wallet_transaction_kind not null,
  quantity numeric not null,
  ref_order_id uuid references trading.orders (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_quantity_finite check (quantity = quantity)
);

create index if not exists wallet_transactions_wallet_asset_idx
  on trading.wallet_transactions (wallet_id, asset_id);

create index if not exists wallet_transactions_wallet_created_idx
  on trading.wallet_transactions (wallet_id, created_at desc);

create unique index if not exists wallet_transactions_trade_buy_order_uidx
  on trading.wallet_transactions (ref_order_id)
  where kind = 'trade_buy' and ref_order_id is not null;

create unique index if not exists wallet_transactions_trade_sell_order_uidx
  on trading.wallet_transactions (ref_order_id)
  where kind = 'trade_sell' and ref_order_id is not null;

alter table trading.wallets enable row level security;
alter table trading.wallet_transactions enable row level security;

drop policy if exists wallets_select on trading.wallets;
create policy wallets_select on trading.wallets
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = wallets.executor_id and e.user_id = auth.uid()
    )
  );

drop policy if exists wallet_transactions_select on trading.wallet_transactions;
create policy wallet_transactions_select on trading.wallet_transactions
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from trading.wallets w
      join trading.executors e on e.id = w.executor_id
      where w.id = wallet_transactions.wallet_id and e.user_id = auth.uid()
    )
  );

grant select on trading.wallets to authenticated;
grant select on trading.wallet_transactions to authenticated;
grant all on trading.wallets to service_role;
grant all on trading.wallet_transactions to service_role;

-- ---------------------------------------------------------------------------
-- 2) Executors: migrated risk counters (from risk_state) + wallets (1:1 via wallets.executor_id)
-- ---------------------------------------------------------------------------
alter table trading.executors
  add column if not exists risk_open_position_count integer not null default 0
    constraint executors_risk_open_positions_chk check (risk_open_position_count >= 0),
  add column if not exists risk_exposure_by_market jsonb not null default '{}'::jsonb,
  add column if not exists risk_daily_pnl_eur numeric not null default 0,
  add column if not exists risk_runtime_max_drawdown_eur numeric not null default 0,
  add column if not exists risk_kill_switch boolean not null default false,
  add column if not exists risk_consecutive_losses integer not null default 0
    constraint executors_risk_consecutive_losses_chk check (risk_consecutive_losses >= 0);

update trading.executors e
set
  risk_open_position_count = coalesce(rs.open_position_count, 0),
  risk_exposure_by_market = coalesce(rs.exposure_by_market, '{}'::jsonb),
  risk_daily_pnl_eur = coalesce(rs.daily_pnl_eur, 0),
  risk_runtime_max_drawdown_eur = coalesce(rs.max_drawdown_eur, 0),
  risk_kill_switch = coalesce(rs.kill_switch, false),
  risk_consecutive_losses = coalesce(rs.consecutive_losses, 0)
from trading.risk_state rs
where rs.executor_id = e.id and rs.user_id = e.user_id;

insert into trading.wallets (user_id, executor_id)
select e.user_id, e.id
from trading.executors e
where not exists (select 1 from trading.wallets w where w.executor_id = e.id);

create or replace function trading.trg_executors_create_wallet()
returns trigger
language plpgsql
security definer
set search_path = trading, public
as $$
begin
  if exists (select 1 from trading.wallets w where w.executor_id = new.id) then
    return new;
  end if;
  insert into trading.wallets (user_id, executor_id) values (new.user_id, new.id);
  return new;
end;
$$;

drop trigger if exists executors_create_wallet on trading.executors;
create trigger executors_create_wallet
  after insert on trading.executors
  for each row
  execute procedure trading.trg_executors_create_wallet();

revoke all on function trading.trg_executors_create_wallet() from public;

-- ---------------------------------------------------------------------------
-- 3) Backfill wallet_transactions from legacy ledger (EUR asset)
-- ---------------------------------------------------------------------------
do $$
declare
  v_eur uuid;
begin
  select a.id into v_eur
  from catalog.assets a
  where upper(trim(a.code)) = 'EUR'
  order by a.created_at asc nulls last
  limit 1;

  if v_eur is null then
    raise exception 'catalog.assets: EUR row required for ledger backfill';
  end if;

  insert into trading.wallet_transactions (
    user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note, created_at
  )
  select
    lg.user_id,
    w.id,
    v_eur,
    case lg.kind::text
      when 'deposit' then 'deposit'::trading.wallet_transaction_kind
      when 'withdrawal' then 'withdrawal'::trading.wallet_transaction_kind
      when 'trade_buy' then 'trade_buy'::trading.wallet_transaction_kind
      when 'trade_sell' then 'trade_sell'::trading.wallet_transaction_kind
      else 'deposit'::trading.wallet_transaction_kind
    end,
    lg.amount_eur,
    lg.ref_order_id,
    lg.note,
    lg.created_at
  from trading.executor_balance_ledger lg
  join trading.wallets w on w.executor_id = lg.executor_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Drop legacy ledger + risk_state + old RPCs
-- ---------------------------------------------------------------------------
drop function if exists trading.apply_executor_balance_change(uuid, text, numeric, text);
drop function if exists trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric);
drop function if exists trading.apply_executor_trade_sell_credit(uuid, uuid, uuid, numeric);

drop table if exists trading.executor_balance_ledger cascade;

drop policy if exists risk_state_select on trading.risk_state;
drop policy if exists risk_state_insert on trading.risk_state;
drop policy if exists risk_state_update on trading.risk_state;
drop policy if exists risk_state_delete on trading.risk_state;

drop table if exists trading.risk_state cascade;

drop function if exists public.trading_risk_state_row_accessible(uuid, uuid);
drop function if exists public.trading_risk_state_insert_check(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 5) Rename trade_decisions → decisions (FKs follow in PG)
-- ---------------------------------------------------------------------------
alter table trading.trade_decisions rename to decisions;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'trading' and c.relkind = 'i' and c.relname = 'trade_decisions_user_created_idx'
  ) then
    execute 'alter index trading.trade_decisions_user_created_idx rename to decisions_user_created_idx';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'trading' and c.relkind = 'i' and c.relname = 'trade_decisions_user_executor_signal_uidx'
  ) then
    execute 'alter index trading.trade_decisions_user_executor_signal_uidx rename to decisions_user_executor_signal_uidx';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) positions: optional link to opening wallet transaction
-- ---------------------------------------------------------------------------
alter table trading.positions
  add column if not exists opening_wallet_transaction_id uuid references trading.wallet_transactions (id) on delete set null;

create index if not exists positions_opening_wallet_tx_idx
  on trading.positions (opening_wallet_transaction_id)
  where opening_wallet_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 7) RPC: dashboard deposit / withdrawal (returns new balance for asset)
-- ---------------------------------------------------------------------------
create or replace function trading.apply_wallet_balance_change(
  p_executor_id uuid,
  p_kind text,
  p_asset_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = trading, catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_id uuid;
  v_wallet uuid;
  v_bal numeric;
  v_delta numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_kind is distinct from 'deposit' and p_kind is distinct from 'withdrawal' then
    raise exception 'invalid kind';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity != p_quantity then
    raise exception 'quantity must be a positive finite number';
  end if;

  if p_asset_id is null then
    raise exception 'asset_id required';
  end if;

  select e.user_id, w.id
  into v_user_id, v_wallet
  from trading.executors e
  join trading.wallets w on w.executor_id = e.id
  where e.id = p_executor_id and e.user_id = v_uid;

  if v_user_id is null or v_wallet is null then
    raise exception 'executor not found';
  end if;

  select coalesce(sum(wt.quantity), 0) into v_bal
  from trading.wallet_transactions wt
  where wt.wallet_id = v_wallet and wt.asset_id = p_asset_id;

  if p_kind = 'deposit' then
    v_delta := p_quantity;
    insert into trading.wallet_transactions (
      user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note
    ) values (
      v_user_id, v_wallet, p_asset_id, 'deposit'::trading.wallet_transaction_kind,
      v_delta, null, nullif(trim(coalesce(p_note, '')), '')
    );
  else
    if v_bal < p_quantity then
      raise exception 'insufficient_balance';
    end if;
    v_delta := -p_quantity;
    insert into trading.wallet_transactions (
      user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note
    ) values (
      v_user_id, v_wallet, p_asset_id, 'withdrawal'::trading.wallet_transaction_kind,
      v_delta, null, nullif(trim(coalesce(p_note, '')), '')
    );
  end if;

  select coalesce(sum(wt.quantity), 0) into v_bal
  from trading.wallet_transactions wt
  where wt.wallet_id = v_wallet and wt.asset_id = p_asset_id;

  return v_bal;
end;
$$;

revoke all on function trading.apply_wallet_balance_change(uuid, text, uuid, numeric, text) from public;
grant execute on function trading.apply_wallet_balance_change(uuid, text, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC: trade buy debit (quote asset)
-- ---------------------------------------------------------------------------
create or replace function trading.apply_wallet_trade_buy_debit(
  p_user_id uuid,
  p_executor_id uuid,
  p_order_id uuid,
  p_debit_eur numeric
)
returns numeric
language plpgsql
security definer
set search_path = trading, catalog, public
as $$
declare
  v_wallet uuid;
  v_quote uuid;
  v_bal numeric;
  v_note text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_debit_eur is null or p_debit_eur <= 0 or p_debit_eur != p_debit_eur then
    raise exception 'invalid debit';
  end if;

  select w.id into v_wallet
  from trading.executors e
  join trading.wallets w on w.executor_id = e.id
  where e.id = p_executor_id and e.user_id = p_user_id;

  if v_wallet is null then
    raise exception 'executor_wallet_missing';
  end if;

  if exists (
    select 1 from trading.wallet_transactions wt
    where wt.ref_order_id = p_order_id and wt.kind = 'trade_buy'
  ) then
    select m.quote_asset_id into v_quote
    from trading.orders o
    join catalog.markets m on m.id = o.market_id
    where o.id = p_order_id
    limit 1;

    select coalesce(sum(wt.quantity), 0) into v_bal
    from trading.wallet_transactions wt
    where wt.wallet_id = v_wallet and wt.asset_id = v_quote;

    return v_bal;
  end if;

  select m.quote_asset_id into v_quote
  from trading.orders o
  join catalog.markets m on m.id = o.market_id
  where o.id = p_order_id
  limit 1;

  if v_quote is null then
    raise exception 'quote_asset_not_found';
  end if;

  select
    case
      when coalesce(nullif(trim(a.code), ''), '') <> '' and coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Buy: ' || trim(a.code) || ' (' || trim(m.market_symbol) || ')'
      when coalesce(nullif(trim(a.code), ''), '') <> '' then
        'Buy: ' || trim(a.code)
      when coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Buy: ' || trim(m.market_symbol)
      else
        'Buy (filled)'
    end
  into v_note
  from trading.orders o
  join trading.decisions td on td.id = o.decision_id
  join trading.signals sig on sig.id = td.signal_id
  join catalog.candles c on c.id = sig.candle_id
  join catalog.markets m on m.id = c.market_id
  left join catalog.assets a on a.id = m.asset_id
  where o.id = p_order_id
  limit 1;

  if v_note is null or btrim(v_note) = '' then
    v_note := 'Buy (filled)';
  end if;

  select coalesce(sum(wt.quantity), 0) into v_bal
  from trading.wallet_transactions wt
  where wt.wallet_id = v_wallet and wt.asset_id = v_quote;

  if v_bal < p_debit_eur then
    raise exception 'insufficient_balance';
  end if;

  insert into trading.wallet_transactions (
    user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note
  ) values (
    p_user_id, v_wallet, v_quote, 'trade_buy'::trading.wallet_transaction_kind,
    -p_debit_eur, p_order_id, v_note
  );

  select coalesce(sum(wt.quantity), 0) into v_bal
  from trading.wallet_transactions wt
  where wt.wallet_id = v_wallet and wt.asset_id = v_quote;

  return v_bal;
end;
$$;

revoke all on function trading.apply_wallet_trade_buy_debit(uuid, uuid, uuid, numeric) from public;
grant execute on function trading.apply_wallet_trade_buy_debit(uuid, uuid, uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 9) RPC: trade sell credit (quote asset)
-- ---------------------------------------------------------------------------
create or replace function trading.apply_wallet_trade_sell_credit(
  p_user_id uuid,
  p_executor_id uuid,
  p_order_id uuid,
  p_credit_eur numeric
)
returns numeric
language plpgsql
security definer
set search_path = trading, catalog, public
as $$
declare
  v_wallet uuid;
  v_quote uuid;
  v_bal numeric;
  v_note text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_credit_eur is null or p_credit_eur <= 0 or p_credit_eur != p_credit_eur then
    raise exception 'invalid credit';
  end if;

  select w.id into v_wallet
  from trading.executors e
  join trading.wallets w on w.executor_id = e.id
  where e.id = p_executor_id and e.user_id = p_user_id;

  if v_wallet is null then
    raise exception 'executor_wallet_missing';
  end if;

  if exists (
    select 1 from trading.wallet_transactions wt
    where wt.ref_order_id = p_order_id and wt.kind = 'trade_sell'
  ) then
    select m.quote_asset_id into v_quote
    from trading.orders o
    join catalog.markets m on m.id = o.market_id
    where o.id = p_order_id
    limit 1;

    select coalesce(sum(wt.quantity), 0) into v_bal
    from trading.wallet_transactions wt
    where wt.wallet_id = v_wallet and wt.asset_id = v_quote;

    return v_bal;
  end if;

  select m.quote_asset_id into v_quote
  from trading.orders o
  join catalog.markets m on m.id = o.market_id
  where o.id = p_order_id
  limit 1;

  if v_quote is null then
    raise exception 'quote_asset_not_found';
  end if;

  select
    case
      when coalesce(nullif(trim(a.code), ''), '') <> '' and coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Sell: ' || trim(a.code) || ' (' || trim(m.market_symbol) || ')'
      when coalesce(nullif(trim(a.code), ''), '') <> '' then
        'Sell: ' || trim(a.code)
      when coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Sell: ' || trim(m.market_symbol)
      else
        'Sell (filled)'
    end
  into v_note
  from trading.orders o
  join catalog.markets m on m.id = o.market_id
  left join catalog.assets a on a.id = m.asset_id
  where o.id = p_order_id
  limit 1;

  if v_note is null or btrim(v_note) = '' then
    v_note := 'Sell (filled)';
  end if;

  insert into trading.wallet_transactions (
    user_id, wallet_id, asset_id, kind, quantity, ref_order_id, note
  ) values (
    p_user_id, v_wallet, v_quote, 'trade_sell'::trading.wallet_transaction_kind,
    p_credit_eur, p_order_id, v_note
  );

  select coalesce(sum(wt.quantity), 0) into v_bal
  from trading.wallet_transactions wt
  where wt.wallet_id = v_wallet and wt.asset_id = v_quote;

  return v_bal;
end;
$$;

revoke all on function trading.apply_wallet_trade_sell_credit(uuid, uuid, uuid, numeric) from public;
grant execute on function trading.apply_wallet_trade_sell_credit(uuid, uuid, uuid, numeric) to service_role;

-- Drop legacy enum if nothing references it
drop type if exists trading.executor_balance_ledger_kind;
