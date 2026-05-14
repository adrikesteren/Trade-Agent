-- P2 / Trading framework v2 — sides framework.
--
-- Until now every position/order was implicitly long-only spot. We now model
-- "position_side" explicitly so the system can later open both LONG and SHORT
-- exposure on the same market for the same executor (one long + one short).
--
-- Migration M6 + M7 (combined to keep the schema consistent in a single step):
--   M6: trading.position_side enum + add columns to positions/orders/decisions +
--       trading.executors.allowed_sides + check constraints.
--   M7: positions uniqueness keyed on (user, executor, market, position_side) so
--       long and short can coexist for the same (executor, market).

-- 1) Enum + helper constants
do $$
begin
  if not exists (
    select 1 from pg_type
    where typnamespace = 'trading'::regnamespace and typname = 'position_side'
  ) then
    create type trading.position_side as enum ('long', 'short');
  end if;
end $$;

-- 2) trading.executors.allowed_sides — array of position_side, default {'long'}.
--    A NULL or empty array would be ambiguous, so we enforce at least one element
--    via a CHECK and seed all existing rows to {'long'}.
alter table trading.executors
  add column if not exists allowed_sides trading.position_side[] not null default array['long']::trading.position_side[];

-- Ensure no existing row has a NULL/empty array (idempotent).
update trading.executors
set allowed_sides = array['long']::trading.position_side[]
where allowed_sides is null or coalesce(array_length(allowed_sides, 1), 0) = 0;

alter table trading.executors
  drop constraint if exists executors_allowed_sides_nonempty;

alter table trading.executors
  add constraint executors_allowed_sides_nonempty
  check (allowed_sides is not null and coalesce(array_length(allowed_sides, 1), 0) > 0);

-- 3) trading.positions.position_side — required, default long.
--    All historical rows are spot long, so backfill is the literal 'long'.
alter table trading.positions
  add column if not exists position_side trading.position_side not null default 'long';

-- 4) trading.orders.position_side — required, default long. Future short orders
--    will set this to 'short' so the executor + reconciler can route correctly.
alter table trading.orders
  add column if not exists position_side trading.position_side not null default 'long';

-- 5) trading.decisions.position_side — required, default long. The mediator will
--    populate this explicitly per emitted decision in P2 follow-up.
alter table trading.decisions
  add column if not exists position_side trading.position_side not null default 'long';

-- 6) Positions uniqueness — one row per (user, executor, market, side).
--    Drop any pre-existing trio uniqueness from earlier migrations and recreate
--    as a four-tuple. We use an INDEX (not a constraint) for flexibility and to
--    match the style of `positions_user_executor_market_idx` from the executor
--    migration.
do $$
declare
  cname text;
begin
  -- Drop CHECK/UNIQUE constraints whose definition matches the legacy trio.
  for cname in
    select conname from pg_constraint
    where conrelid = 'trading.positions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%user_id%executor_id%market_id%'
      and pg_get_constraintdef(oid) not ilike '%position_side%'
  loop
    execute format('alter table trading.positions drop constraint if exists %I', cname);
  end loop;
end $$;

drop index if exists trading.positions_user_executor_market_idx;
drop index if exists trading.positions_user_executor_market_uidx;

create unique index if not exists positions_user_executor_market_side_uidx
  on trading.positions (user_id, executor_id, market_id, position_side);

-- 7) Quick lookup index for "all open positions for an executor of a given side".
create index if not exists positions_executor_side_idx
  on trading.positions (executor_id, position_side)
  where quantity > 0;

-- 8) Comments for self-documentation.
comment on column trading.executors.allowed_sides is
  'P2: subset of position sides this executor may open. UI gates against catalog.exchanges.supports_*; mediator + executor reject sides outside this set.';
comment on column trading.positions.position_side is
  'P2: long (spot/margin) or short (margin). Long+short can coexist on the same (user, executor, market).';
comment on column trading.orders.position_side is
  'P2: side this order is opening or closing. Long-only flow keeps this at "long".';
comment on column trading.decisions.position_side is
  'P2: side the mediator proposes. SAR (P3) writes pairs of decisions per signal: EXIT long + ENTER short (or vice-versa).';
