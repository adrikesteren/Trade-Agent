-- Re-seed `regime-classifier-15m-v1` to use a 4h trend timeframe instead of daily.
--
-- The original P3 seed (20260723110400) used a daily SMA(200), which on a 15m platform means
-- waiting 200 days (~6.5 months) of stored history before the classifier emits anything other
-- than `insufficient_bars` → `sideways`. On localhost-first, 6.5 months of backfilled history
-- per market is steep, so we move the regime classification down to a 4h trend timeframe with
-- the same SMA(200) shape: 200 × 4h ≈ 33 days of warmup needed instead.
--
-- The dispatcher reads `config.trendTimeframeMinutes` (default 240); the warmup helper
-- (`computeWarmupBars` in `historical-candles-for-replay-load.service.ts`) derives the 15m
-- bar requirement from `maPeriod × trendTimeframeMinutes / 15`. Both branches stay consistent
-- with the seed.
--
-- Also drops the legacy `slopeBpsThreshold` key — the eval reads `slopePctEps` /
-- `distancePctEps` and ignores `slopeBpsThreshold` entirely; it has been dead config since
-- the P3 wireup.
--
-- Existing `trading.signals` rows for this agent are NOT touched here. They keep their old
-- `metadata` (rule, regime, maPeriod, slopeBars but no `trendTimeframeMinutes`) until a
-- re-evaluation overwrites them via the upsert path (signal_agent_id, candle_id, user_id).
-- Use the "Re-evaluate regime" header button on the market detail page (or hit
-- `/api/workers/market-evaluate-all-signals?marketId=…&forceAgentSlugs=regime-classifier-15m-v1`
-- with a CRON_SECRET bearer token) to overwrite stale rows in place — the row id is preserved
-- so any downstream FK references in `trading.decisions` / `trading.orders` survive.

update trading.signal_agents
set
  description =
    '4h SMA(200) trend regime classifier on 15m closes (aggregated to 4h in-memory). ' ||
    'Emits HOLD with metadata.regime in {bull, bear, sideways}. ' ||
    'Read by the mediator (regime gating) and by SAR (paired EXIT/ENTER on confirmed flip). ' ||
    'Needs ~33 days of 15m history (= 200 × 4h bars) before producing real classifications.',
  config = (config - 'slopeBpsThreshold')
    || jsonb_build_object(
      'maPeriod', 200,
      'slopeLookback', 20,
      'trendTimeframeMinutes', 240
    ),
  updated_at = now()
where agent_id = 'regime-classifier-15m-v1';
