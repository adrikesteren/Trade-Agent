-- P3 wireup follow-up: clarify the regime-classifier-15m-v1 description.
--
-- The original seed in `20260723110400_seed_p3_signal_agents.sql` said
-- "Daily-200 trend regime classifier on 15m closes" which is technically
-- correct (it is evaluated at each 15m bar close) but obscures the more
-- important fact that the trend itself is computed on **daily-aggregated**
-- bars. With the dispatcher now actively routing this agent through the
-- 15m → 1d aggregator, the clearer phrasing matters for operators looking
-- at the signal-agents page.
--
-- No functional impact — config keys are unchanged.

update trading.signal_agents
set
  description = 'Daily SMA(200) regime classifier; trend timeframe = 1d, evaluated at each 15m bar close. Emits HOLD with metadata.regime in {bull, bear, sideways}. Read by the mediator (regime gating) and by SAR (paired EXIT/ENTER on confirmed flip).',
  updated_at = now()
where agent_id = 'regime-classifier-15m-v1';
