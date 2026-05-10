-- Dashboard executor detail: PnL snapshot without transferring all filled orders or candle history.
create or replace function trading.executor_dashboard_pnl_snapshot(
  p_executor_id uuid,
  p_user_id uuid,
  p_catalog_timeframe text default '5m'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = trading, catalog, public
as $$
declare
  v_filled numeric;
  v_cost numeric;
  v_mark_sum numeric := 0;
  v_px numeric;
  v_missing boolean := false;
  r record;
begin
  select coalesce(sum(o.notional_eur::numeric), 0)
  into v_filled
  from trading.orders o
  where o.executor_id = p_executor_id
    and o.user_id = p_user_id
    and o.status = 'filled'
    and o.side = 'buy';

  select coalesce(sum(p.quantity::numeric * p.avg_price::numeric), 0)
  into v_cost
  from trading.positions p
  where p.executor_id = p_executor_id
    and p.user_id = p_user_id
    and p.quantity::numeric > 0
    and p.avg_price is not null;

  if not exists (
    select 1
    from trading.positions p
    where p.executor_id = p_executor_id
      and p.user_id = p_user_id
      and p.quantity::numeric > 0
      and p.avg_price is not null
  ) then
    return jsonb_build_object(
      'filled_buy_notional_eur', v_filled,
      'open_cost_basis_eur', v_cost,
      'open_mark_value_eur', case when v_cost > 0 then v_cost else null end,
      'unrealized_eur', 0
    );
  end if;

  for r in
    select p.market_id, p.quantity::numeric as qty, p.avg_price::numeric as avg
    from trading.positions p
    where p.executor_id = p_executor_id
      and p.user_id = p_user_id
      and p.quantity::numeric > 0
      and p.avg_price is not null
  loop
    select c.close::numeric
    into v_px
    from catalog.candles c
    join catalog.candle_timestamps ct on ct.id = c.candle_timestamp_id
    where c.market_id = r.market_id
      and c.timeframe = p_catalog_timeframe
    order by ct.close_time desc
    limit 1;

    if v_px is null then
      v_missing := true;
      exit;
    end if;

    v_mark_sum := v_mark_sum + r.qty * v_px;
  end loop;

  if v_missing then
    return jsonb_build_object(
      'filled_buy_notional_eur', v_filled,
      'open_cost_basis_eur', v_cost,
      'open_mark_value_eur', null,
      'unrealized_eur', null
    );
  end if;

  return jsonb_build_object(
    'filled_buy_notional_eur', v_filled,
    'open_cost_basis_eur', v_cost,
    'open_mark_value_eur', v_mark_sum,
    'unrealized_eur', v_mark_sum - v_cost
  );
end;
$$;

comment on function trading.executor_dashboard_pnl_snapshot(uuid, uuid, text) is
  'PnL strip for executor detail: SUM filled buy notionals, position cost basis, mark from latest catalog close per open market.';

grant execute on function trading.executor_dashboard_pnl_snapshot(uuid, uuid, text) to authenticated;
grant execute on function trading.executor_dashboard_pnl_snapshot(uuid, uuid, text) to service_role;
