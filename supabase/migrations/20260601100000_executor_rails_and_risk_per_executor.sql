-- Mediator rails + default notional on executors; risk_state scoped per executor.

-- 1) Executor columns (defaults match apps/web mediator defaultRails + notional 100)
alter table trading.executors
  add column if not exists default_notional_eur numeric not null default 100
    constraint executors_default_notional_positive check (default_notional_eur > 0),
  add column if not exists max_risk_per_trade numeric not null default 0.05
    constraint executors_max_risk_per_trade_chk check (max_risk_per_trade > 0 and max_risk_per_trade <= 1),
  add column if not exists max_open_positions integer not null default 5
    constraint executors_max_open_positions_chk check (max_open_positions >= 0),
  add column if not exists max_exposure_per_symbol_eur numeric not null default 500
    constraint executors_max_exposure_per_symbol_chk check (max_exposure_per_symbol_eur >= 0),
  add column if not exists daily_loss_limit_eur numeric not null default 100
    constraint executors_daily_loss_limit_chk check (daily_loss_limit_eur >= 0),
  add column if not exists max_drawdown_eur numeric not null default 500
    constraint executors_max_drawdown_chk check (max_drawdown_eur >= 0),
  add column if not exists cooldown_after_losses integer not null default 3
    constraint executors_cooldown_chk check (cooldown_after_losses >= 0),
  add column if not exists allow_add boolean not null default false,
  add column if not exists mediator_rails_extra jsonb not null default '{}'::jsonb;

comment on column trading.executors.mediator_rails_extra is 'Optional JSON overrides merged after typed rail columns (advanced).';

-- Ensure existing rows have explicit values (idempotent if defaults already applied)
update trading.executors set
  default_notional_eur = 100,
  max_risk_per_trade = 0.05,
  max_open_positions = 5,
  max_exposure_per_symbol_eur = 500,
  daily_loss_limit_eur = 100,
  max_drawdown_eur = 500,
  cooldown_after_losses = 3,
  allow_add = false,
  mediator_rails_extra = coalesce(mediator_rails_extra, '{}'::jsonb)
where true;

-- 2) risk_state: add executor_id (nullable until backfill)
alter table trading.risk_state
  add column if not exists executor_id uuid references trading.executors (id) on delete cascade;

-- Users with risk_state but no executor: seed Default executor (same shape as app seed)
insert into trading.executors (
  user_id, name, enabled, execution_mode, budget_eur, asset_filter_mode, filter_asset_ids,
  default_notional_eur, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur,
  daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, updated_at
)
select distinct
  rs.user_id,
  'Default',
  true,
  'paper'::trading.execution_mode,
  null::numeric,
  'all'::trading.executor_asset_filter_mode,
  '{}'::uuid[],
  100,
  0.05,
  5,
  500,
  100,
  500,
  3,
  false,
  '{}'::jsonb,
  now()
from trading.risk_state rs
where not exists (select 1 from trading.executors ex where ex.user_id = rs.user_id);

-- Attach legacy risk_state row to preferred executor per user
update trading.risk_state rs
set executor_id = pe.id
from (
  select distinct on (e.user_id) e.user_id, e.id
  from trading.executors e
  order by e.user_id, case when lower(trim(e.name)) = 'default' then 0 else 1 end, e.created_at asc
) pe
where rs.user_id = pe.user_id
  and rs.executor_id is null;

-- Fail fast if any risk_state could not be matched (should not happen after seed insert)
do $$
begin
  if exists (select 1 from trading.risk_state where executor_id is null) then
    raise exception 'risk_state rows remain without executor_id after backfill';
  end if;
end $$;

-- New risk_state rows for every executor that does not have one yet (fresh paper defaults)
insert into trading.risk_state (
  user_id,
  executor_id,
  equity_eur,
  open_position_count,
  exposure_by_market,
  daily_pnl_eur,
  max_drawdown_eur,
  kill_switch,
  consecutive_losses,
  updated_at
)
select
  e.user_id,
  e.id,
  10000,
  0,
  '{}'::jsonb,
  0,
  0,
  false,
  0,
  now()
from trading.executors e
where not exists (select 1 from trading.risk_state r where r.executor_id = e.id);

-- Replace uniqueness: one risk book per (user, executor)
alter table trading.risk_state drop constraint if exists risk_state_user_id_key;
alter table trading.risk_state drop constraint if exists risk_state_user_id_unique;

alter table trading.risk_state alter column executor_id set not null;

create unique index if not exists risk_state_user_executor_uidx
  on trading.risk_state (user_id, executor_id);

-- RLS: tie access to owning user via executor membership
drop policy if exists risk_state_select on trading.risk_state;
drop policy if exists risk_state_insert on trading.risk_state;
drop policy if exists risk_state_update on trading.risk_state;

create policy risk_state_select on trading.risk_state
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = risk_state.executor_id and e.user_id = auth.uid()
    )
  );

create policy risk_state_insert on trading.risk_state
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = risk_state.executor_id and e.user_id = auth.uid()
    )
  );

create policy risk_state_update on trading.risk_state
  for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = risk_state.executor_id and e.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from trading.executors e
      where e.id = risk_state.executor_id and e.user_id = auth.uid()
    )
  );
