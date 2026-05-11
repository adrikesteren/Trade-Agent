-- Executor exchange binding + moving-floor config/state + sell credit ledger RPC.

alter table trading.executors
  add column if not exists exchange_id uuid references catalog.exchanges (id) on delete restrict,
  add column if not exists profit_taking_enabled boolean not null default false,
  add column if not exists moving_floor_trail_pct numeric not null default 0.15
    constraint executors_moving_floor_trail_pct_chk check (moving_floor_trail_pct > 0 and moving_floor_trail_pct < 1),
  add column if not exists moving_floor_activation_profit_pct numeric not null default 0.05
    constraint executors_moving_floor_activation_profit_pct_chk check (moving_floor_activation_profit_pct >= 0 and moving_floor_activation_profit_pct < 1),
  add column if not exists moving_floor_timeframe text not null default '5m'
    constraint executors_moving_floor_timeframe_chk check (length(trim(moving_floor_timeframe)) > 0);

-- Backfill exchange binding (v1 uses Bitvavo only).
update trading.executors e
set exchange_id = x.id
from (
  select id from catalog.exchanges where code = 'bitvavo' limit 1
) x
where e.exchange_id is null;

do $$
begin
  if exists (select 1 from trading.executors where exchange_id is null) then
    raise exception 'executors.exchange_id backfill failed (bitvavo exchange missing?)';
  end if;
end $$;

alter table trading.executors
  alter column exchange_id set not null;

create index if not exists executors_user_exchange_enabled_idx
  on trading.executors (user_id, exchange_id, enabled);

create table if not exists trading.executor_moving_floors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  executor_id uuid not null references trading.executors (id) on delete cascade,
  market_id uuid not null references catalog.markets (id) on delete cascade,
  peak_price_since_entry numeric not null,
  floor_price numeric not null,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint executor_moving_floors_peak_positive_chk check (peak_price_since_entry > 0),
  constraint executor_moving_floors_floor_positive_chk check (floor_price > 0),
  constraint executor_moving_floors_floor_lte_peak_chk check (floor_price <= peak_price_since_entry)
);

create unique index if not exists executor_moving_floors_user_executor_market_uidx
  on trading.executor_moving_floors (user_id, executor_id, market_id);

create index if not exists executor_moving_floors_executor_updated_idx
  on trading.executor_moving_floors (executor_id, updated_at desc);

alter table trading.executor_moving_floors enable row level security;

drop policy if exists executor_moving_floors_select on trading.executor_moving_floors;
create policy executor_moving_floors_select on trading.executor_moving_floors
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists executor_moving_floors_insert on trading.executor_moving_floors;
create policy executor_moving_floors_insert on trading.executor_moving_floors
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists executor_moving_floors_update on trading.executor_moving_floors;
create policy executor_moving_floors_update on trading.executor_moving_floors
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists executor_moving_floors_delete on trading.executor_moving_floors;
create policy executor_moving_floors_delete on trading.executor_moving_floors
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on trading.executor_moving_floors to authenticated;
grant all on trading.executor_moving_floors to service_role;

create unique index if not exists executor_balance_ledger_trade_sell_order_uidx
  on trading.executor_balance_ledger (ref_order_id)
  where kind = 'trade_sell' and ref_order_id is not null;

create or replace function trading.apply_executor_trade_sell_credit(
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
  v_new numeric;
  v_note text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_credit_eur is null or p_credit_eur <= 0 or p_credit_eur != p_credit_eur then
    raise exception 'invalid credit';
  end if;

  if exists (
    select 1 from trading.executor_balance_ledger lg
    where lg.ref_order_id = p_order_id and lg.kind = 'trade_sell'
  ) then
    select rs.equity_eur into v_new
    from trading.risk_state rs
    where rs.executor_id = p_executor_id and rs.user_id = p_user_id;
    return v_new;
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

  update trading.risk_state rs
  set equity_eur = rs.equity_eur + p_credit_eur,
      updated_at = now()
  where rs.executor_id = p_executor_id
    and rs.user_id = p_user_id
  returning rs.equity_eur into v_new;

  if not found then
    raise exception 'risk_state_not_found';
  end if;

  insert into trading.executor_balance_ledger (
    user_id, executor_id, kind, amount_eur, balance_after_eur, ref_order_id, note
  ) values (
    p_user_id, p_executor_id, 'trade_sell'::trading.executor_balance_ledger_kind,
    p_credit_eur, v_new, p_order_id, v_note
  );

  return v_new;
end;
$$;

revoke all on function trading.apply_executor_trade_sell_credit(uuid, uuid, uuid, numeric) from public;
grant execute on function trading.apply_executor_trade_sell_credit(uuid, uuid, uuid, numeric) to service_role;

comment on function trading.apply_executor_trade_sell_credit(uuid, uuid, uuid, numeric) is
  'Worker: add net proceeds after a filled sell; idempotent per order_id. Note names base asset and pair from catalog.';
