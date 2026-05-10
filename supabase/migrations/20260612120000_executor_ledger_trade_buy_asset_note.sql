-- Ledger notes for trade_buy: which base asset / pair the buy was for.
-- (trade_sell has no ledger RPC yet; when added, use the same pattern.)

create or replace function trading.apply_executor_trade_buy_debit(
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
  v_new numeric;
  v_note text;
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
  join catalog.markets m on m.id = o.market_id
  left join catalog.assets a on a.id = m.asset_id
  where o.id = p_order_id
  limit 1;

  if v_note is null or btrim(v_note) = '' then
    v_note := 'Buy (filled)';
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
    -p_debit_eur, v_new, p_order_id, v_note
  );

  return v_new;
end;
$$;

revoke all on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) from public;
grant execute on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) to service_role;

comment on function trading.apply_executor_trade_buy_debit(uuid, uuid, uuid, numeric) is
  'Worker: subtract notional+fee after a filled buy; idempotent per order_id. Note names base asset and pair from catalog.';

-- Backfill notes on existing trade_buy rows (were inserted with null note).
update trading.executor_balance_ledger lg
set note = x.note
from (
  select
    lg2.id,
    case
      when coalesce(nullif(trim(a.code), ''), '') <> '' and coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Buy: ' || trim(a.code) || ' (' || trim(m.market_symbol) || ')'
      when coalesce(nullif(trim(a.code), ''), '') <> '' then
        'Buy: ' || trim(a.code)
      when coalesce(nullif(trim(m.market_symbol), ''), '') <> '' then
        'Buy: ' || trim(m.market_symbol)
      else
        'Buy (filled)'
    end as note
  from trading.executor_balance_ledger lg2
  join trading.orders o on o.id = lg2.ref_order_id
  join catalog.markets m on m.id = o.market_id
  left join catalog.assets a on a.id = m.asset_id
  where lg2.kind = 'trade_buy'
    and lg2.ref_order_id is not null
    and (lg2.note is null or btrim(lg2.note) = '')
) x
where lg.id = x.id;
