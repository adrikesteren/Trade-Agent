-- P2 / Trading framework v2 — move capability flags from `catalog.exchanges` to `catalog.markets`.
--
-- Capabilities are inherently per-market because:
--   1. A venue can support shorts on only a subset of its markets (e.g. Bitvavo
--      launched borrow-and-sell shorts on Feb 4 2026 for exactly 20 EUR-pair
--      markets — BTC/ETH/XRP/SOL/ADA/LINK/SUI/DOGE/HBAR/AVAX/TAO/LTC/ONDO/TRX/
--      FET/VET/SHIB/PEPE/XLM/QNT — not the rest of its order book).
--   2. Spot buy/sell is technically per-market too (delisted markets become
--      sell-only; new listings may be quote-only initially).
--
-- Exchange-level "does this venue support side X anywhere" is computed by the
-- `catalog.v_exchange_capabilities` view (added in 20260724020000_*.sql) and
-- consumed by the executor form when no specific market is locked in yet.
--
-- "Margin" here is intentionally broad: it covers both leveraged products
-- (Kraken Futures, dYdX) and 1x borrow-and-sell shorts (Bitvavo's MiCA-
-- compliant product, 100% EUR collateral, no leverage). A separate leverage
-- flag can be added later if we need to distinguish leveraged vs unleveraged
-- short channels.

alter table catalog.markets
  add column if not exists supports_spot_buy     boolean not null default true,
  add column if not exists supports_spot_sell    boolean not null default true,
  add column if not exists supports_margin_long  boolean not null default false,
  add column if not exists supports_margin_short boolean not null default false;

comment on column catalog.markets.supports_spot_buy is
  'P2: this market accepts spot buys (base purchased with quote). Long entry channel.';
comment on column catalog.markets.supports_spot_sell is
  'P2: this market accepts spot sells (base sold for quote). Long close channel.';
comment on column catalog.markets.supports_margin_long is
  'P2: this market supports leveraged or margin long positions.';
comment on column catalog.markets.supports_margin_short is
  'P2: this market supports short positions (borrow-and-sell or leveraged margin/perp). '
  'Bitvavo''s 1x MiCA-compliant borrow shorts fall under this flag.';
