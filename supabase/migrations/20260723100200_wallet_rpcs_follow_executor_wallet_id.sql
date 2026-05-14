-- P1/M3 — Wallet RPCs follow trading.executors.wallet_id (no signature changes).
--
-- Old behaviour: SELECT trading.wallets.id WHERE executor_id = p_executor_id (assumed 1:1 wallet/executor).
-- After M2: many executors share the same wallet via trading.executors.wallet_id; some historical
-- executors keep an isolated per-executor wallet. Both cases are handled by simply following
-- trading.executors.wallet_id.

-- ---------------------------------------------------------------------------
-- 1) Dashboard deposit / withdrawal RPC (caller-as-user)
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

  select e.user_id, e.wallet_id
  into v_user_id, v_wallet
  from trading.executors e
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
-- 2) Trade buy debit (service-role; quote asset)
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

  select e.wallet_id into v_wallet
  from trading.executors e
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
-- 3) Trade sell credit (service-role; quote asset)
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

  select e.wallet_id into v_wallet
  from trading.executors e
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
