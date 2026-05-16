-- Derived exchange-level capability view + drop the now-obsolete columns
-- on `catalog.exchanges`.
--
-- The view answers the question "does this exchange support side X on at
-- least one of its markets?" — used by the executor form when the user
-- hasn't pinned a single market yet (e.g. asset_filter_mode = 'all' or
-- 'blacklist'). Runtime side-gating in the mediator + executor uses the
-- per-market columns directly (see `fetchMarketCapabilitiesByMarketIds`).

create or replace view catalog.v_exchange_capabilities as
select
  e.id as exchange_id,
  coalesce(bool_or(m.supports_spot_buy),     false) as supports_spot_buy,
  coalesce(bool_or(m.supports_spot_sell),    false) as supports_spot_sell,
  coalesce(bool_or(m.supports_margin_long),  false) as supports_margin_long,
  coalesce(bool_or(m.supports_margin_short), false) as supports_margin_short
from catalog.exchanges e
left join catalog.markets m on m.exchange_id = e.id
group by e.id;

comment on view catalog.v_exchange_capabilities is
  'P2: rollup of per-market capability flags. supports_X is true iff at least '
  'one market on this exchange has supports_X = true. Source of truth for the '
  'executor form''s "Trading stance" picker.';

grant select on catalog.v_exchange_capabilities to authenticated, service_role;

-- Drop the now-stale exchange-level columns. The migration that added them
-- (20260723110000_exchange_capabilities.sql) lives on as historical record
-- of how Bitvavo was originally seeded; from now on the per-market columns
-- (20260724000000_market_capabilities.sql) are authoritative.
alter table catalog.exchanges
  drop column if exists supports_spot_buy,
  drop column if exists supports_spot_sell,
  drop column if exists supports_margin_long,
  drop column if exists supports_margin_short;
