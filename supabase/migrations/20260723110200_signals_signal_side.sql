-- P3/M8 — add `signal_side` to `trading.signals`.
--
-- Phase 2 introduced the `trading.position_side` enum and stamped a side on
-- decisions / orders / positions. Phase 3 extends the model one more step
-- back: signals themselves now declare which side they would take if their
-- intent were `ENTER`. This lets the regime classifier emit `signal_side =
-- 'short'` on a confirmed bear regime, and the mediator can then translate
-- that into a short ENTER decision (gated by `executor.allowed_sides`).
--
-- Existing signals all default to `long` because every deterministic agent
-- shipped before P3 only emitted long entries.

alter table if exists trading.signals
  add column if not exists signal_side trading.position_side
    not null default 'long';

comment on column trading.signals.signal_side is
  'P3: which side this signal would take if its intent is ENTER (long/short). Defaults to long for all pre-P3 agents and for HOLD/EXIT signals where side has no operational meaning. Read by the mediator together with executor.allowed_sides.';

-- Helper index for the SAR / regime-flip lookup which scans the latest
-- regime classifier signals per (signal_agent, side, candle).
create index if not exists signals_signal_agent_side_candle_idx
  on trading.signals (signal_agent_id, signal_side, candle_id);
