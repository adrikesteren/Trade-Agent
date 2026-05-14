-- P2 / Trading framework v2 — exchange capability flags.
--
-- Each exchange can advertise which trading actions are supported. Executors
-- then pick a subset (`allowed_sides`) but cannot select an action the exchange
-- does not support (UI gates this; backend rejects with a reason at decision time).
--
-- Columns:
--   supports_spot_buy     — buy base for quote on the spot book (long entry on a true spot exchange)
--   supports_spot_sell    — sell base for quote on the spot book (close-long-only on a true spot exchange)
--   supports_margin_long  — exchange offers margin/perp long with leverage
--   supports_margin_short — exchange offers margin/perp short
--
-- Bitvavo seeded as spot-only. All other rows default to "spot only" (the safest
-- baseline) so legacy data does not accidentally enable shorting.

alter table catalog.exchanges
  add column if not exists supports_spot_buy boolean not null default true,
  add column if not exists supports_spot_sell boolean not null default true,
  add column if not exists supports_margin_long boolean not null default false,
  add column if not exists supports_margin_short boolean not null default false;

-- Comment for self-documentation (visible in supabase studio + psql \d+).
comment on column catalog.exchanges.supports_spot_buy is
  'P2: spot buy supported (long entry on spot book).';
comment on column catalog.exchanges.supports_spot_sell is
  'P2: spot sell supported (long close on spot book).';
comment on column catalog.exchanges.supports_margin_long is
  'P2: margin/perp long with leverage supported.';
comment on column catalog.exchanges.supports_margin_short is
  'P2: margin/perp short supported.';

-- Bitvavo: spot-only, no margin. Idempotent: only updates the row if it exists.
update catalog.exchanges
set supports_spot_buy = true,
    supports_spot_sell = true,
    supports_margin_long = false,
    supports_margin_short = false
where code = 'bitvavo';
