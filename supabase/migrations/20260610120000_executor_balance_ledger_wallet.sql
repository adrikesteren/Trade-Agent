-- Executor-assigned EUR balance (risk_state.equity_eur), ledger, RPCs; defaults: saldo 0, new executors disabled by default.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'trading' and t.typname = 'executor_balance_ledger_kind'
  ) then
    create type trading.executor_balance_ledger_kind as enum (
      'deposit',
      'withdrawal',
      'trade_buy',
      'trade_sell'
    );
  end if;
end $$;

create table if not exists trading.executor_balance_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  executor_id uuid not null references trading.executors (id) on delete cascade,
  kind trading.executor_balance_ledger_kind not null,
  amount_eur numeric not null,
  balance_after_eur numeric not null,
  ref_order_id uuid references trading.orders (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint executor_balance_ledger_amount_finite check (amount_eur = amount_eur),
  constraint executor_balance_ledger_balance_finite check (balance_after_eur = balance_after_eur)
);

create index if not exists executor_balance_ledger_executor_created_idx
  on trading.executor_balance_ledger (executor_id, created_at desc);

create unique index if not exists executor_balance_ledger_trade_buy_order_uidx
  on trading.executor_balance_ledger (ref_order_id)
  where kind = 'trade_buy' and ref_order_id is not null;

alter table trading.executor_balance_ledger enable row level security;

drop policy if exists executor_balance_ledger_select on trading.executor_balance_ledger;
create policy executor_balance_ledger_select on trading.executor_balance_ledger
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = executor_balance_ledger.executor_id and e.user_id = auth.uid()
    )
  );

-- Inserts only via SECURITY DEFINER functions (no direct insert policy for authenticated).

grant select on trading.executor_balance_ledger to authenticated;
grant all on trading.executor_balance_ledger to service_role;

-- New risk rows default to 0 EUR; existing rows unchanged.
alter table trading.risk_state alter column equity_eur set default 0;

-- New executors default disabled unless insert sets enabled.
alter table trading.executors alter column enabled set default false;

-- ---------------------------------------------------------------------------
-- Authenticated: deposit / withdrawal (dashboard)
-- ---------------------------------------------------------------------------
create or replace function trading.apply_executor_balance_change(
  p_executor_id uuid,
  p_kind text,
  p_amount_eur numeric,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = trading, public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_id uuid;
  v_equity numeric;
  v_delta numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_kind is distinct from 'deposit' and p_kind is distinct from 'withdrawal' then
    raise exception 'invalid kind';
  end if;

  if p_amount_eur is null or p_amount_eur <= 0 or p_amount_eur != p_amount_eur then
    raise exception 'amount must be a positive finite number';
  end if;

  select e.user_id into v_user_id
  from trading.executors e
  where e.id = p_executor_id and e.user_id = v_uid;

  if v_user_id is null then
    raise exception 'executor not found';
  end if;

  select rs.equity_eur into v_equity
  from trading.risk_state rs
  where rs.executor_id = p_executor_id and rs.user_id = v_uid
  for update;

  if not found then
    raise exception 'risk_state not found for executor';
  end if;

  if p_kind = 'deposit' then
    v_delta := p_amount_eur;
    v_equity := v_equity + v_delta;
    insert into trading.executor_balance_ledger (
      user_id, executor_id, kind, amount_eur, balance_after_eur, ref_order_id, note
    ) values (
      v_user_id, p_executor_id, 'deposit'::trading.executor_balance_ledger_kind,
      v_delta, v_equity, null, nullif(trim(coalesce(p_note, '')), '')
    );
  else
    if v_equity < p_amount_eur then
      raise exception 'insufficient_balance';
    end if;
    v_delta := -p_amount_eur;
    v_equity := v_equity + v_delta;
    insert into trading.executor_balance_ledger (
      user_id, executor_id, kind, amount_eur, balance_after_eur, ref_order_id, note
    ) values (
      v_user_id, p_executor_id, 'withdrawal'::trading.executor_balance_ledger_kind,
      v_delta, v_equity, null, nullif(trim(coalesce(p_note, '')), '')
    );
  end if;

  update trading.risk_state
  set equity_eur = v_equity, updated_at = now()
  where executor_id = p_executor_id and user_id = v_uid;

  return v_equity;
end;
$$;

revoke all on function trading.apply_executor_balance_change(uuid, text, numeric, text) from public;
grant execute on function trading.apply_executor_balance_change(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Service role: debit after a filled buy order (idempotent per order)
-- ---------------------------------------------------------------------------
create or replace function trading.apply_executor_trade_buy_debit(
  p_user_id uuid,
  p_executor_id uuid,
  p_order_id uuid,
  p_debit_eur numeric
)
returns numeric
language plpgsql
security definer
set search_path = trading, public
as $$
declare
  v_new numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_debit_eur is null or p_debit_eur <= 0 or p_debit_eur != p_debit_eur then
    raise exception 'invalid debit';
  end if;

  if exists (
    select 1 from trading.executor_balance_ledger lg
    where lg.ref_order_id = p_order_id and lg.kind = 'trade_buy'
  ) then
    select rs.equity_eur into v_new
    from trading.risk_state rs
    where rs.executor_id = p_executor_id and rs.user_id = p_user_id;
    return v_new;
  end if;

  update trading.risk_state rs
  set equity_eur = rs.equity_eur - p_debit_eur,
      updated_at = now()
  where rs.executor_id = p_executor_id
    and rs.user_id = p_user_id
    and rs.equity_eur >= p_debit_eur
  returning rs.equity_eur into v_new;

  if not found then
    raise exception 'insufficient_balance';
  end if;

  insert into trading.executor_balance_ledger (
    user_id, executor_id, kind, amount_eur, balance_after_eur, ref_order_id, note
  ) values (
    p_user_id, p_executor_id, 'trade_buy'::trading.executor_balance_ledger_kind,
    -p_debit_eur, v_new, p_order_id, null
  );

  return v_new;
end;
$$;

revoke all on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) from public;
grant execute on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) to service_role;

comment on table trading.executor_balance_ledger is 'Append-only EUR cash movements for an executor (deposits, withdrawals, trade debits). balance_after_eur matches risk_state.equity_eur after each row.';
comment on function trading.apply_executor_balance_change(uuid, text, numeric, text) is 'Dashboard: deposit or withdrawal; updates risk_state.equity_eur atomically.';
comment on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) is 'Worker: subtract notional+fee after a filled buy; idempotent per order_id.';
