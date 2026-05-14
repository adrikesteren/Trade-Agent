-- P1/M1 — Per-quote-asset notional budget per executor.
-- Replaces the single trading.executors.default_notional_eur value with a junction table
-- that holds one max_notional_primary (in the owner's primary fiat) per allowed quote asset.
--
-- max_notional_primary is stored in the OWNER'S primary fiat (e.g. EUR or USD).
-- At decision time the mediator converts to the market's quote using catalog.assets.dollar_value.
--
-- See AGENTS.md "Wallets and quote-asset budgets" + the trading-framework-v2 plan.

-- ---------------------------------------------------------------------------
-- 1) Table + audit columns + auto-name (EQB-{0000})
-- ---------------------------------------------------------------------------
create table if not exists trading.executor_quote_asset_budget (
  id                    uuid primary key default gen_random_uuid(),
  name                  text,
  executor_id           uuid not null references trading.executors (id) on delete cascade,
  quote_asset_id        uuid not null references catalog.assets (id) on delete restrict,
  max_notional_primary  numeric not null,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  constraint executor_quote_asset_budget_max_positive
    check (max_notional_primary > 0),
  constraint executor_quote_asset_budget_unique
    unique (executor_id, quote_asset_id)
);

comment on table trading.executor_quote_asset_budget is
  'Per (executor, quote asset) notional budget. Numbers stored in the OWNERs primary fiat (catalog.assets.dollar_value used for conversion).';

comment on column trading.executor_quote_asset_budget.max_notional_primary is
  'Suggested per-trade notional in the owner''s primary fiat (e.g. USD or EUR). Mediator converts to market quote at decision time.';

create index if not exists executor_quote_asset_budget_executor_idx
  on trading.executor_quote_asset_budget (executor_id);

create index if not exists executor_quote_asset_budget_quote_asset_idx
  on trading.executor_quote_asset_budget (quote_asset_id);

-- ---------------------------------------------------------------------------
-- 2) Auto-name + updated_at triggers
-- ---------------------------------------------------------------------------
create sequence if not exists trading.executor_quote_asset_budget_name_seq;

create or replace function trading.set_executor_quote_asset_budget_auto_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.format_auto_name(
      'EQB-', 4, nextval('trading.executor_quote_asset_budget_name_seq')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_executor_quote_asset_budget_auto_name on trading.executor_quote_asset_budget;
create trigger trg_executor_quote_asset_budget_auto_name
  before insert on trading.executor_quote_asset_budget
  for each row execute function trading.set_executor_quote_asset_budget_auto_name();

drop trigger if exists trg_executor_quote_asset_budget_set_updated_at on trading.executor_quote_asset_budget;
create trigger trg_executor_quote_asset_budget_set_updated_at
  before update on trading.executor_quote_asset_budget
  for each row execute function public.set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------
alter table trading.executor_quote_asset_budget enable row level security;

drop policy if exists executor_quote_asset_budget_select on trading.executor_quote_asset_budget;
create policy executor_quote_asset_budget_select on trading.executor_quote_asset_budget
  for select to authenticated
  using (
    exists (
      select 1 from trading.executors e
      where e.id = executor_quote_asset_budget.executor_id
        and public.row_owner_visible(e.user_id)
    )
  );

drop policy if exists executor_quote_asset_budget_insert on trading.executor_quote_asset_budget;
create policy executor_quote_asset_budget_insert on trading.executor_quote_asset_budget
  for insert to authenticated
  with check (
    exists (
      select 1 from trading.executors e
      where e.id = executor_quote_asset_budget.executor_id
        and public.trading_row_accessible(e.user_id)
    )
  );

drop policy if exists executor_quote_asset_budget_update on trading.executor_quote_asset_budget;
create policy executor_quote_asset_budget_update on trading.executor_quote_asset_budget
  for update to authenticated
  using (
    exists (
      select 1 from trading.executors e
      where e.id = executor_quote_asset_budget.executor_id
        and public.trading_row_accessible(e.user_id)
    )
  )
  with check (
    exists (
      select 1 from trading.executors e
      where e.id = executor_quote_asset_budget.executor_id
        and public.trading_row_accessible(e.user_id)
    )
  );

drop policy if exists executor_quote_asset_budget_delete on trading.executor_quote_asset_budget;
create policy executor_quote_asset_budget_delete on trading.executor_quote_asset_budget
  for delete to authenticated
  using (
    exists (
      select 1 from trading.executors e
      where e.id = executor_quote_asset_budget.executor_id
        and public.trading_row_accessible(e.user_id)
    )
  );

grant select, insert, update, delete on trading.executor_quote_asset_budget to authenticated;
grant all on trading.executor_quote_asset_budget to service_role;

-- ---------------------------------------------------------------------------
-- 4) Backfill from existing trading.executors.default_notional_eur
-- ---------------------------------------------------------------------------
-- For each executor, look at the markets the executor can trade (filter by exchange + asset_filter_mode):
--   - asset_filter_mode = 'all'        → every market on the executor's exchange.
--   - asset_filter_mode = 'whitelist'  → only markets whose base asset is in filter_asset_ids.
--   - asset_filter_mode = 'blacklist'  → all markets on the exchange whose base is NOT in filter_asset_ids.
-- Then DISTINCT the quote_asset_id values and insert one budget row per quote.
--
-- Conversion: max_notional_primary = default_notional_eur * EUR.dollar_value / primary.dollar_value
--   (default_notional_eur is in EUR; we read EUR's dollar_value and the user's primary fiat dollar_value).
-- If either dollar_value is missing or non-positive, fall back to 100 (matches the legacy default).

do $$
declare
  v_eur_id uuid;
  v_eur_dv numeric;
begin
  select a.id, a.dollar_value
    into v_eur_id, v_eur_dv
    from catalog.assets a
   where a.kind = 'fiat'::public.asset_kind
     and upper(trim(a.code)) = 'EUR'
   order by a.created_at asc nulls last
   limit 1;

  if v_eur_id is null then
    raise exception 'M1 backfill: catalog.assets EUR row required';
  end if;

  with allowed_quotes as (
    select distinct
      e.id   as executor_id,
      m.quote_asset_id
    from trading.executors e
    join catalog.markets m
      on m.exchange_id = e.exchange_id
    where m.quote_asset_id is not null
      and (
        e.asset_filter_mode = 'all'::trading.executor_asset_filter_mode
        or (
          e.asset_filter_mode = 'whitelist'::trading.executor_asset_filter_mode
          and m.asset_id = any(coalesce(e.filter_asset_ids, '{}'::uuid[]))
        )
        or (
          e.asset_filter_mode = 'blacklist'::trading.executor_asset_filter_mode
          and (m.asset_id is null or not (m.asset_id = any(coalesce(e.filter_asset_ids, '{}'::uuid[]))))
        )
      )
  )
  insert into trading.executor_quote_asset_budget (
    executor_id,
    quote_asset_id,
    max_notional_primary,
    created_by
  )
  select
    aq.executor_id,
    aq.quote_asset_id,
    -- Convert default_notional_eur (EUR) → primary fiat units via dollar_value triangulation
    case
      when up.primary_asset_id = v_eur_id then
        coalesce(e.default_notional_eur, 100)
      when v_eur_dv is null or v_eur_dv <= 0 or pa.dollar_value is null or pa.dollar_value <= 0 then
        100
      else
        coalesce(e.default_notional_eur, 100) * v_eur_dv / pa.dollar_value
    end as max_notional_primary,
    e.user_id as created_by
  from allowed_quotes aq
  join trading.executors e on e.id = aq.executor_id
  left join public.user_preferences up on up.user_id = e.user_id
  left join catalog.assets pa on pa.id = up.primary_asset_id
  on conflict (executor_id, quote_asset_id) do nothing;
end $$;
