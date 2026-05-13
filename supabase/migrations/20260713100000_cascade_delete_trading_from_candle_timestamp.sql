-- Deleting catalog.candle_timestamps already CASCADE-deletes catalog.candles.
-- Wire the rest of the bar row so trading rows disappear with the candle:
--   candle_timestamps -> candles -> signals -> trade_decisions -> orders -> fills
-- (fills.orders FK is already ON DELETE CASCADE.)

alter table trading.signals
  drop constraint if exists signals_candle_id_fkey;

alter table trading.signals
  add constraint signals_candle_id_fkey
    foreign key (candle_id) references catalog.candles (id) on delete cascade;

alter table trading.trade_decisions
  drop constraint if exists trade_decisions_signal_id_fkey;

alter table trading.trade_decisions
  add constraint trade_decisions_signal_id_fkey
    foreign key (signal_id) references trading.signals (id) on delete cascade;

alter table trading.orders
  drop constraint if exists orders_decision_id_fkey;

alter table trading.orders
  add constraint orders_decision_id_fkey
    foreign key (decision_id) references trading.trade_decisions (id) on delete cascade;
