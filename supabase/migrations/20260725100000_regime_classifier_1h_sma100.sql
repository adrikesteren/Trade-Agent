-- Re-seed `regime-classifier-15m-v1` to react faster to short-term regime flips.
--
-- Previous (20260725000000): 4h × SMA(200), slope 20 → MA memory ~33 days,
--   slope window ~3.3 days. Multi-day pumps inside a bear regime never flipped
--   the SMA in time, so the mediator stayed in `bear` while the chart was
--   clearly making higher highs.
--
-- New: 1h × SMA(100), slope 12 → MA memory ~4 days, slope window ~12h. A 1-2
--   day reversal will tilt both close-vs-MA and slope decisively, so the regime
--   flips by the time the entry agents wake up. Trade-off: more whipsaw on
--   ranging markets — that's acceptable because regime gating only demotes
--   ENTER intents (it never invents trades by itself), and the optional SAR
--   path still requires a confirmed flip across two regime classifier signals
--   before pairing EXIT + ENTER.
--
-- Warmup math (used by `computeWarmupBars`):
--   max(maPeriod=100, slopeLookback+1=13) × (60 / 15) = 100 × 4 = **400 × 15m
--   bars** ≈ ~4.2 days of stored history (down from ~33 days at 4h × 200).
--
-- Existing `trading.signals` rows for this agent stay in place; the row id is
-- preserved when the upsert overwrites them, so any FK references in
-- `trading.decisions` / `trading.orders` keep pointing at the same signal.
-- Run the "Re-evaluate regime" header button on each market — or POST to
-- `/api/workers/market-evaluate-all-signals-all-markets?forceAgentSlugs=regime-classifier-15m-v1`
-- (CRON_SECRET bearer) — to force a fresh classification with the new config.

update trading.signal_agents
set
  description =
    '1h SMA(100) trend regime classifier on 15m closes (aggregated to 1h in-memory). ' ||
    'Emits HOLD with metadata.regime in {bull, bear, sideways}. ' ||
    'Read by the mediator (regime gating) and by SAR (paired EXIT/ENTER on confirmed flip). ' ||
    'Needs ~4 days of 15m history (= 100 × 1h bars) before producing real classifications.',
  config = jsonb_build_object(
    'maPeriod', 100,
    'slopeLookback', 12,
    'trendTimeframeMinutes', 60
  ),
  updated_at = now()
where agent_id = 'regime-classifier-15m-v1';
