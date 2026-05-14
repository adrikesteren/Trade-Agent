-- P3: seed signal agent rows for the new evaluation services introduced
-- in Trading Framework v2 / Phase 3 (regime classifier + multi-timeframe
-- confluence). Existing v1 agent rows (ma-cross-15m-v1, rsi-reversion-5m-v1,
-- breakout-atr-5m-v1) are extended with new gate keys (volatility, volume,
-- ADX, overbought) so the evaluators pick up sane defaults out of the box.
--
-- Idempotent: re-runs upsert config keys without resetting unrelated keys.

-- 1) Regime classifier (SMA-200 of higher-timeframe close + slope check).
--    Mediator + SAR look up signals tagged with this agent_id slug.
insert into trading.signal_agents (name, agent_id, enabled, version, description, config, allowed_timeframes)
values (
  'Regime Classifier (15m)',
  'regime-classifier-15m-v1',
  true,
  '1',
  'Daily-200 trend regime classifier on 15m closes; emits HOLD with metadata.regime in {bull, bear, sideways}. Read by the mediator (regime gating) and by SAR (paired EXIT/ENTER on confirmed flip).',
  jsonb_build_object(
    'maPeriod', 200,
    'slopeLookback', 20,
    'slopeBpsThreshold', 5
  ),
  array['15m']::text[]
)
on conflict (agent_id) do update
set
  name = excluded.name,
  enabled = excluded.enabled,
  version = excluded.version,
  description = excluded.description,
  config = excluded.config,
  allowed_timeframes = excluded.allowed_timeframes,
  updated_at = now();

-- 2) Multi-timeframe confluence (4h trend + 15m RSI entry). Long-only for now.
insert into trading.signal_agents (name, agent_id, enabled, version, description, config, allowed_timeframes)
values (
  'Multi-Timeframe Confluence (15m)',
  'multi-tf-confluence-15m-v1',
  true,
  '1',
  'Multi-timeframe confluence: requires higher-timeframe (4h) trend up via SMA + lower-timeframe (15m) RSI entry trigger; emits ENTER long when both align, HOLD otherwise.',
  jsonb_build_object(
    'trendTimeframe', '4h',
    'trendMaPeriod', 50,
    'entryRsiPeriod', 14,
    'entryRsiOversold', 35
  ),
  array['15m']::text[]
)
on conflict (agent_id) do update
set
  name = excluded.name,
  enabled = excluded.enabled,
  version = excluded.version,
  description = excluded.description,
  config = excluded.config,
  allowed_timeframes = excluded.allowed_timeframes,
  updated_at = now();

-- 3) Extend existing v1 agents with P3 gate defaults. We jsonb-merge so any
--    custom values added later by an operator survive the next run.
update trading.signal_agents
set
  config = config
    || jsonb_build_object(
      'minAtrPct', 0.002,        -- 0.2% — skip very flat bars
      'maxAtrPct', 0.05          -- 5% — skip super-volatile bars
    ),
  updated_at = now()
where agent_id in ('ma-cross-15m-v1', 'rsi-reversion-5m-v1', 'breakout-atr-5m-v1');

-- RSI overbought + ADX cap so mean-reversion ENTER skips strong trends.
update trading.signal_agents
set
  config = config
    || jsonb_build_object(
      'overbought', 70,
      'maxAdx', 25,
      'adxPeriod', 14
    ),
  updated_at = now()
where agent_id = 'rsi-reversion-5m-v1';

-- Breakout: volume confirmation + ADX floor so breakouts only fire in trends.
update trading.signal_agents
set
  config = config
    || jsonb_build_object(
      'volumeConfirmationMultiplier', 1.5,
      'volumeLookbackBars', 20,
      'minAdx', 20,
      'adxPeriod', 14
    ),
  updated_at = now()
where agent_id = 'breakout-atr-5m-v1';
