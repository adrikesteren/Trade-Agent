-- `coingecko_asset_metrics` was only ever `sync_runs.job_key` (not a physical table).
-- Live CoinGecko USD fields live on `public.assets`; the old append-only table was `asset_coingecko_metrics` (dropped in 20260515140000).
update public.sync_runs
set job_key = 'coingecko_assets_usd_live'
where job_key = 'coingecko_asset_metrics';
