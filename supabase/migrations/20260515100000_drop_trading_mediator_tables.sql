-- Remove premature per-user trading / mediator stack (rebuild step-by-step later).
-- Catalog (exchanges, assets, markets, candles, sync_runs) is unchanged.

drop table if exists public.fills cascade;
drop table if exists public.orders cascade;
drop table if exists public.positions cascade;
drop table if exists public.trade_decisions cascade;
drop table if exists public.signals cascade;
drop table if exists public.risk_state cascade;
drop table if exists public.connectors cascade;

drop type if exists public.order_status;
drop type if exists public.order_side;
drop type if exists public.signal_action;
drop type if exists public.trade_mode;
