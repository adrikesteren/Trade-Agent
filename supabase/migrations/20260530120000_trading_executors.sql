-- Multiple spot executors per user (portfolios): paper/live, budget, asset whitelist/blacklist (exclusive).

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'trading'::regnamespace and typname = 'executor_asset_filter_mode') then
    create type trading.executor_asset_filter_mode as enum ('all', 'whitelist', 'blacklist');
  end if;
end $$;

create table if not exists trading.executors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  execution_mode trading.execution_mode not null default 'paper',
  budget_eur numeric,
  asset_filter_mode trading.executor_asset_filter_mode not null default 'all',
  filter_asset_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint executors_name_nonempty check (length(trim(name)) > 0),
  constraint executors_budget_nonnegative check (budget_eur is null or budget_eur >= 0),
  constraint executors_filter_assets_chk check (
    asset_filter_mode = 'all'::trading.executor_asset_filter_mode
    or (
      filter_asset_ids is not null
      and coalesce(array_length(filter_asset_ids, 1), 0) > 0
    )
  )
);

create index if not exists executors_user_enabled_idx
  on trading.executors (user_id, enabled);

create index if not exists executors_user_created_idx
  on trading.executors (user_id, created_at desc);

alter table trading.executors enable row level security;

drop policy if exists executors_select on trading.executors;
create policy executors_select on trading.executors
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists executors_insert on trading.executors;
create policy executors_insert on trading.executors
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists executors_update on trading.executors;
create policy executors_update on trading.executors
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists executors_delete on trading.executors;
create policy executors_delete on trading.executors
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on trading.executors to authenticated;
grant all on trading.executors to service_role;

-- Nullable columns for phased backfill
alter table trading.trade_decisions
  add column if not exists executor_id uuid references trading.executors (id) on delete restrict;

alter table trading.orders
  add column if not exists executor_id uuid references trading.executors (id) on delete restrict;

alter table trading.positions
  add column if not exists executor_id uuid references trading.executors (id) on delete restrict;

-- Seed one default executor per user that already has trading or preference rows
insert into trading.executors (user_id, name, enabled, execution_mode, budget_eur, asset_filter_mode, filter_asset_ids, updated_at)
select
  su.user_id,
  'Default',
  true,
  coalesce(pref.execution_mode, 'paper'::trading.execution_mode),
  null,
  'all'::trading.executor_asset_filter_mode,
  '{}'::uuid[],
  now()
from (
  select distinct user_id
  from (
    select user_id from trading.user_execution_preferences
    union
    select user_id from trading.trade_decisions
    union
    select user_id from trading.orders
    union
    select user_id from trading.positions
  ) u
) su (user_id)
left join trading.user_execution_preferences pref on pref.user_id = su.user_id
where not exists (select 1 from trading.executors e where e.user_id = su.user_id);

-- Backfill foreign keys (prefer executor named Default, then oldest)
update trading.trade_decisions td
set executor_id = pe.id
from (
  select distinct on (e.user_id) e.user_id, e.id
  from trading.executors e
  order by e.user_id, case when e.name = 'Default' then 0 else 1 end, e.created_at asc
) pe
where td.user_id = pe.user_id
  and td.executor_id is null;

update trading.orders o
set executor_id = td.executor_id
from trading.trade_decisions td
where o.decision_id = td.id
  and o.executor_id is null
  and td.executor_id is not null;

update trading.orders o
set executor_id = pe.id
from (
  select distinct on (e.user_id) e.user_id, e.id
  from trading.executors e
  order by e.user_id, case when e.name = 'Default' then 0 else 1 end, e.created_at asc
) pe
where o.user_id = pe.user_id
  and o.executor_id is null;

update trading.positions p
set executor_id = pe.id
from (
  select distinct on (e.user_id) e.user_id, e.id
  from trading.executors e
  order by e.user_id, case when e.name = 'Default' then 0 else 1 end, e.created_at asc
) pe
where p.user_id = pe.user_id
  and p.executor_id is null;

-- Merge duplicate (user_id, executor_id, market_id) after both paper books pointed to same default executor
with agg as (
  select
    user_id,
    executor_id,
    market_id,
    (array_agg(id order by id))[1] as keep_id,
    sum(quantity)::numeric as total_qty,
    (sum(quantity * coalesce(avg_price, 0)) / nullif(sum(quantity), 0))::numeric as wavg
  from trading.positions
  where executor_id is not null
  group by user_id, executor_id, market_id
  having count(*) > 1
)
update trading.positions p
set
  quantity = agg.total_qty,
  avg_price = agg.wavg,
  updated_at = now()
from agg
where p.id = agg.keep_id;

delete from trading.positions p
using (
  select
    user_id,
    executor_id,
    market_id,
    (array_agg(id order by id))[1] as keep_id
  from trading.positions
  group by user_id, executor_id, market_id
) k
where p.user_id = k.user_id
  and p.executor_id = k.executor_id
  and p.market_id = k.market_id
  and p.id <> k.keep_id;

alter table trading.trade_decisions alter column executor_id set not null;
alter table trading.orders alter column executor_id set not null;
alter table trading.positions alter column executor_id set not null;

drop index if exists trading.trade_decisions_user_market_timeframe_close_uidx;

create unique index if not exists trade_decisions_user_executor_market_timeframe_close_uidx
  on trading.trade_decisions (user_id, executor_id, market_id, timeframe, close_time);

drop index if exists trading.orders_user_executor_created_idx;
create index orders_user_executor_created_idx
  on trading.orders (user_id, executor_id, created_at desc);

-- Replace positions uniqueness: one row per (user, executor, market)
do $$
declare
  cname text;
begin
  for cname in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'trading'
      and t.relname = 'positions'
      and c.contype = 'u'
  loop
    execute format('alter table trading.positions drop constraint if exists %I', cname);
  end loop;
end $$;

create unique index if not exists positions_user_executor_market_uidx
  on trading.positions (user_id, executor_id, market_id);
