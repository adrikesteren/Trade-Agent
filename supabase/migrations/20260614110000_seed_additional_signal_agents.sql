-- Seed additional v1 signal agents (idempotent).

insert into trading.signal_agents (agent_id, enabled, version, description, config, allowed_timeframes)
values
(
  'rsi-reversion-5m-v1',
  true,
  '1',
  'RSI mean-reversion on 5m closes; ENTER when RSI crosses up from oversold, else HOLD.',
  jsonb_build_object('rsiPeriod', 14, 'oversold', 30),
  array['5m']::text[]
),
(
  'breakout-atr-5m-v1',
  true,
  '1',
  'Breakout with ATR filter on 5m closes; ENTER on qualified range break, else HOLD.',
  jsonb_build_object('lookbackBars', 20, 'atrPeriod', 14, 'atrMultiplier', 1.2),
  array['5m']::text[]
)
on conflict (agent_id) do update
set
  enabled = excluded.enabled,
  version = excluded.version,
  description = excluded.description,
  config = excluded.config,
  allowed_timeframes = excluded.allowed_timeframes,
  updated_at = now();
