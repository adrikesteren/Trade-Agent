-- Per-executor opt-out for trade-fill Slack webhook (sendTradeFillSlack).

alter table trading.executors
  add column if not exists slack_trade_notifications_enabled boolean not null default true;

comment on column trading.executors.slack_trade_notifications_enabled is
  'When true, executor-related trade fills may post to TRADE_FILL_SLACK_WEBHOOK_URL (if configured).';
