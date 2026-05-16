-- Seed: Bitvavo's 20 shortable EUR-pair markets (live since 4 Feb 2026).
-- Source: https://bitcoingids.com/bitvavo-short-gaan/
--
-- Bitvavo offers borrow-and-sell shorts at 1x (no leverage, MiCA-regulated)
-- on these 20 EUR pairs. The user posts EUR collateral, Bitvavo lends the
-- base asset, the system sells it immediately, and the position closes by
-- buying the base back and repaying the loan. PnL + collateral stay in EUR.
--
-- This migration is idempotent and narrowly targeted:
--   - exchange = bitvavo
--   - quote = EUR (fiat)
--   - base ∈ {20 supported assets}
--
-- Any market that doesn't match keeps the schema default (supports_margin_short=false).

update catalog.markets m
set supports_margin_short = true
from catalog.assets a, catalog.assets q, catalog.exchanges e
where m.asset_id = a.id
  and m.quote_asset_id = q.id
  and m.exchange_id = e.id
  and e.code = 'bitvavo'
  and q.code = 'EUR'
  and q.kind = 'fiat'
  and a.code in (
    'BTC', 'ETH', 'XRP', 'SOL', 'ADA',
    'LINK', 'SUI', 'DOGE', 'HBAR', 'AVAX',
    'TAO', 'LTC', 'ONDO', 'TRX', 'FET',
    'VET', 'SHIB', 'PEPE', 'XLM', 'QNT'
  );
