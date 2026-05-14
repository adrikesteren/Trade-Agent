-- P3/M10 — widen the decisions unique key to include `position_side`.
--
-- Pre-P3 the constraint was `(user_id, executor_id, signal_id)`. That
-- prevented the SAR (Stop-and-Reverse) flow from writing TWO decisions for
-- the same signal on a confirmed regime flip: one EXIT for the held side
-- plus one ENTER for the opposite side. Both rows share the same parent
-- regime-classifier signal but differ in `position_side`.
--
-- This migration:
-- 1. Drops the old unique index `decisions_user_executor_signal_uidx`.
-- 2. Recreates it as `(user_id, executor_id, signal_id, position_side)`.
--
-- Existing rows all default `position_side='long'` (P2/M6 default), so no
-- data migration is needed.

drop index if exists trading.decisions_user_executor_signal_uidx;

create unique index if not exists decisions_user_executor_signal_side_uidx
  on trading.decisions (user_id, executor_id, signal_id, position_side);

comment on index trading.decisions_user_executor_signal_side_uidx is
  'P3: per-(user, executor, signal, position_side). Widened from (user, executor, signal) so SAR can write paired EXIT+ENTER decisions on a confirmed regime flip.';
