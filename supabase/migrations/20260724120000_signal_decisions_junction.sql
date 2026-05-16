-- Plan 2 / Step 1 — replace `decisions.signal_id` (1:N) with an M:N junction
-- table `trading.signal_decisions` that records per-signal scoring, and move
-- the bar identity onto `decisions.candle_id` (was: resolved through `signals`).
--
-- Migration sequence:
-- 1. Create the junction table with FKs to decisions + signals, plus scoring.
-- 2. Backfill one junction row per existing decision (score=1.0, reasons={}).
-- 3. Add `decisions.candle_id`, backfill from `signals.candle_id`, set NOT NULL,
--    and bind the FK with `on delete cascade` (parity with the bar-aligned
--    cascade chain already in place for signals).
-- 4. Drop the old unique index + FK on `decisions.signal_id`, then drop the
--    column itself.
-- 5. Add the new unique constraint keyed by (user, executor, candle, side).
-- 6. Enable RLS + policies on `trading.signal_decisions` mirroring the
--    automation-friendly pattern already used on `trading.decisions`
--    (`public.trading_row_*` helpers).
--
-- Alpha hard-cut: no backwards-compat for `decisions.signal_id` after this
-- migration applies. Callers must read signals via the junction.

-- ---------------------------------------------------------------------------
-- 1) Create junction table.
-- ---------------------------------------------------------------------------
-- One row per (decision, signal) edge. `score` is the mediator's per-signal
-- contribution to the decision, `reasons` is a free-form JSON blob for audit
-- (rule codes, thresholds, etc.).
create table if not exists trading.signal_decisions (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references trading.decisions (id) on delete cascade,
  signal_id   uuid not null references trading.signals (id) on delete cascade,
  score       numeric not null,
  reasons     jsonb,
  created_at  timestamptz not null default now(),
  unique (decision_id, signal_id)
);

-- Lookup helpers: fetch all decisions touched by a signal (and vice-versa).
create index if not exists signal_decisions_signal_id_idx
  on trading.signal_decisions (signal_id);
create index if not exists signal_decisions_decision_id_idx
  on trading.signal_decisions (decision_id);

comment on table trading.signal_decisions is
  'Plan 2: M:N junction between trading.signals and trading.decisions with per-signal scoring. Replaces decisions.signal_id (which only supported 1:N).';
comment on column trading.signal_decisions.score is
  'Mediator-assigned contribution score for this signal within the parent decision. Range defined by the mediator policy version (see decisions.decision_payload.policyVersion).';
comment on column trading.signal_decisions.reasons is
  'Free-form per-signal audit blob (rule codes, thresholds, gating context). Optional.';

-- ---------------------------------------------------------------------------
-- 2) Backfill one junction row per existing decision.
-- ---------------------------------------------------------------------------
-- Pre-migration every decision had exactly one parent signal (decisions.signal_id).
-- For each decision row, materialise the (decision, signal) edge with a neutral
-- score of 1.0 and an empty `reasons` blob. Done before the column is dropped.
insert into trading.signal_decisions (decision_id, signal_id, score, reasons)
select id, signal_id, 1.0, '{}'::jsonb
from trading.decisions
where signal_id is not null
on conflict (decision_id, signal_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Add `decisions.candle_id` + backfill from `signals.candle_id`, then bind
--    the FK with `on delete cascade` (matches the candle_timestamp → candles →
--    signals cascade chain in 20260713100000).
-- ---------------------------------------------------------------------------
alter table trading.decisions
  add column if not exists candle_id uuid;

update trading.decisions d
   set candle_id = s.candle_id
  from trading.signals s
 where d.signal_id = s.id
   and d.candle_id is null;

alter table trading.decisions
  alter column candle_id set not null;

alter table trading.decisions
  drop constraint if exists decisions_candle_id_fkey;
alter table trading.decisions
  add constraint decisions_candle_id_fkey
  foreign key (candle_id) references catalog.candles (id) on delete cascade;

create index if not exists decisions_candle_id_idx
  on trading.decisions (candle_id);

comment on column trading.decisions.candle_id is
  'Plan 2: bar identity moves onto the decision directly (was: resolved through signals.candle_id). Cascades on candle delete to keep trading rows aligned with the bar chain.';

-- ---------------------------------------------------------------------------
-- 4) Drop old unique index + FK on `decisions.signal_id`, then drop the column.
-- ---------------------------------------------------------------------------
-- The current uniqueness shape (P3/M10) is `decisions_user_executor_signal_side_uidx`
-- — a unique INDEX (not a named constraint). Dropping it before the column
-- drop avoids a `column referenced by` error.
drop index if exists trading.decisions_user_executor_signal_side_uidx;

-- FK names survived the trade_decisions → decisions rename in
-- 20260714100000_wallets_replace_ledger_risk_decisions.sql, so the original
-- `trade_decisions_signal_id_fkey` name from 20260713100000 is still in effect.
alter table trading.decisions
  drop constraint if exists trade_decisions_signal_id_fkey;
alter table trading.decisions
  drop constraint if exists decisions_signal_id_fkey;

alter table trading.decisions
  drop column if exists signal_id;

-- ---------------------------------------------------------------------------
-- 5) New unique constraint keyed by (user, executor, candle, side).
-- ---------------------------------------------------------------------------
-- Same SAR pairing semantics as the previous index, but the bar identity
-- column moved from `signal_id` (a 1:N FK to signals) to `candle_id` (the
-- candle that triggered the decision, regardless of which signals fed it).
alter table trading.decisions
  drop constraint if exists decisions_user_executor_candle_side_unique;
alter table trading.decisions
  add constraint decisions_user_executor_candle_side_unique
  unique (user_id, executor_id, candle_id, position_side);

comment on constraint decisions_user_executor_candle_side_unique on trading.decisions is
  'Plan 2: per-(user, executor, candle, position_side). Replaces the (user, executor, signal, position_side) shape now that signal linkage moved to the junction.';

-- ---------------------------------------------------------------------------
-- 6) RLS on `trading.signal_decisions` — mirror `trading.decisions` policy
--    shape so the same automation/normal-user split applies.
-- ---------------------------------------------------------------------------
alter table trading.signal_decisions enable row level security;

-- SELECT: caller can read a junction row when they can read the parent
-- decision. Goes through `decisions` so the helper `public.trading_row_accessible`
-- governs visibility uniformly (automation user sees all, normal user sees
-- own + automation-owned).
drop policy if exists signal_decisions_select on trading.signal_decisions;
create policy signal_decisions_select on trading.signal_decisions
  for select to authenticated
  using (
    exists (
      select 1 from trading.decisions d
      where d.id = signal_decisions.decision_id
        and public.trading_row_accessible(d.user_id)
    )
  );

-- INSERT: caller can write a junction row when they can write to the parent
-- decision (i.e. they own it OR they are the automation user).
drop policy if exists signal_decisions_insert on trading.signal_decisions;
create policy signal_decisions_insert on trading.signal_decisions
  for insert to authenticated
  with check (
    exists (
      select 1 from trading.decisions d
      where d.id = signal_decisions.decision_id
        and public.trading_row_insert_check(d.user_id)
    )
  );

-- UPDATE / DELETE: same as SELECT (parent-decision visibility implies write).
drop policy if exists signal_decisions_update on trading.signal_decisions;
create policy signal_decisions_update on trading.signal_decisions
  for update to authenticated
  using (
    exists (
      select 1 from trading.decisions d
      where d.id = signal_decisions.decision_id
        and public.trading_row_accessible(d.user_id)
    )
  )
  with check (
    exists (
      select 1 from trading.decisions d
      where d.id = signal_decisions.decision_id
        and public.trading_row_insert_check(d.user_id)
    )
  );

drop policy if exists signal_decisions_delete on trading.signal_decisions;
create policy signal_decisions_delete on trading.signal_decisions
  for delete to authenticated
  using (
    exists (
      select 1 from trading.decisions d
      where d.id = signal_decisions.decision_id
        and public.trading_row_accessible(d.user_id)
    )
  );

grant select on trading.signal_decisions to authenticated;
grant all    on trading.signal_decisions to service_role;
