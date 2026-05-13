-- Bar identity via signals.candle_id; trade_decisions drops market_id/close_time; orders drops market_id.

-- ---------------------------------------------------------------------------
-- 1) Backfill trading.signals.candle_id from catalog bar
-- ---------------------------------------------------------------------------
update trading.signals s
set candle_id = c.id
from catalog.candles c
join catalog.candle_timestamps ct on ct.id = c.candle_timestamp_id
where s.candle_id is null
  and c.market_id = s.market_id
  and c.timeframe = s.timeframe
  and ct.close_time = s.close_time;

do $$
begin
  if exists (select 1 from trading.signals where candle_id is null) then
    raise exception 'trading.signals: candle_id backfill incomplete (null candle_id remains)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Canonical signal per (user_id, signal_agent_id, candle_id): repoint FKs, delete dupes
-- ---------------------------------------------------------------------------
update automation.signal_runs sr
set signal_id = r.keep_id
from (
  select
    s.id,
    min(s.id::text) over (partition by s.user_id, s.signal_agent_id, s.candle_id)::uuid as keep_id
  from trading.signals s
) r
where sr.signal_id = r.id
  and r.id <> r.keep_id;

update trading.trade_decisions td
set signal_id = r.keep_id
from (
  select
    s.id,
    min(s.id::text) over (partition by s.user_id, s.signal_agent_id, s.candle_id)::uuid as keep_id
  from trading.signals s
) r
where td.signal_id = r.id
  and r.id <> r.keep_id;

delete from trading.signals s
where exists (
  select 1
  from trading.signals s2
  where s2.user_id = s.user_id
    and s2.signal_agent_id = s.signal_agent_id
    and s2.candle_id = s.candle_id
    and s2.id < s.id
);

-- ---------------------------------------------------------------------------
-- 3) trade_decisions: remove orphans and duplicate (user, executor, signal) keeping newest
-- ---------------------------------------------------------------------------
delete from trading.orders o
where o.decision_id in (select id from trading.trade_decisions where signal_id is null);

delete from trading.trade_decisions where signal_id is null;

delete from trading.orders o
where o.decision_id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by user_id, executor_id, signal_id
        order by created_at desc nulls last, id desc
      ) as rn
    from trading.trade_decisions
    where signal_id is not null
  ) x
  where x.rn > 1
);

delete from trading.trade_decisions td
where td.id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by user_id, executor_id, signal_id
        order by created_at desc nulls last, id desc
      ) as rn
    from trading.trade_decisions
    where signal_id is not null
  ) x
  where x.rn > 1
);

-- ---------------------------------------------------------------------------
-- 4) trading.signals: drop old unique + redundant columns (market_id, timeframe, close_time)
-- ---------------------------------------------------------------------------
alter table trading.signals drop constraint if exists signals_user_signal_agent_market_timeframe_close_key;

alter table trading.signals
  drop column if exists market_id,
  drop column if exists timeframe,
  drop column if exists close_time;

alter table trading.signals alter column candle_id set not null;

create unique index if not exists signals_user_signal_agent_candle_uidx
  on trading.signals (user_id, signal_agent_id, candle_id);

-- ---------------------------------------------------------------------------
-- 5) trading.trade_decisions: drop bar columns + old unique; unique on (user, executor, signal)
-- ---------------------------------------------------------------------------
drop index if exists trading.trade_decisions_user_executor_market_timeframe_close_uidx;

alter table trading.trade_decisions drop column if exists market_id;
alter table trading.trade_decisions drop column if exists close_time;

alter table trading.trade_decisions alter column signal_id set not null;

create unique index if not exists trade_decisions_user_executor_signal_uidx
  on trading.trade_decisions (user_id, executor_id, signal_id);

-- ---------------------------------------------------------------------------
-- 6) Postgres: ledger note joins (orders no longer have market_id)
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
  join trading.trade_decisions td on td.id = o.decision_id
  join trading.signals sig on sig.id = td.signal_id
  join catalog.candles c on c.id = sig.candle_id
  join catalog.markets m on m.id = c.market_id
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
  join trading.trade_decisions td on td.id = o.decision_id
  join trading.signals sig on sig.id = td.signal_id
  join catalog.candles c on c.id = sig.candle_id
  join catalog.markets m on m.id = c.market_id
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

-- Ledger backfill for empty notes (same join as buy debit)
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
  join trading.trade_decisions td on td.id = o.decision_id
  join trading.signals sig on sig.id = td.signal_id
  join catalog.candles c on c.id = sig.candle_id
  join catalog.markets m on m.id = c.market_id
  left join catalog.assets a on a.id = m.asset_id
  where lg2.kind = 'trade_buy'
    and lg2.ref_order_id is not null
    and (lg2.note is null or btrim(lg2.note) = '')
) x
where lg.id = x.id;

-- ---------------------------------------------------------------------------
-- 7) trading.orders: drop market_id
-- ---------------------------------------------------------------------------
alter table trading.orders drop column if exists market_id;
