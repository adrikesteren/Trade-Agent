# Signal agents — developer & AI agent guide

This document describes **what a Signal Agent is in this repo**, what it **must** and **must not** do, how it is **triggered**, and how to **add** or **debug** one. It complements the product-level role split in [how-we-use-agents.md](./how-we-use-agents.md).

Audience: human developers and **Cursor / automation agents** editing this codebase.

---

## Role in the pipeline

1. **Ingest** writes closed OHLCV to `catalog.candles` (catalog storage timeframe: `15m` — see `CATALOG_STORAGE_TIMEFRAME` in the web app).
2. **Signal agents** (this document) read that data and append **advice** to `trading.signals` (`intent`, `confidence`, `reasons`, …). They **never** place orders.
3. **Trade Mediator** reads signals + portfolio/risk and upserts `trade_decisions` (see [mediator-developer.md](./mediator-developer.md)).
4. **Executor** executes approved decisions into `orders` / `fills` ([executor-developer.md](./executor-developer.md)).

Signal agents are **not** the Cursor IDE assistant; here “agent” means a **named signal producer**: stable slug `trading.signal_agents.agent_id` (e.g. `ma-cross-15m-v1`) plus row PK `trading.signal_agents.id` used as **`trading.signals.signal_agent_id`** (FK for UI and integrity).

---

## Tasks a Signal Agent **must** perform

- **Read market history** for a `(market_id, timeframe)` from `catalog.candles`, joined to `catalog.candle_timestamps` for `close_time`, with enough bars for the rule (e.g. slow MA length).
- **Evaluate** the rule set for the **target closed bar** (`close_time` / `closeTimeIso` passed by the worker).
- **Write** at most one row per `(user_id, signal_agent_id, market_id, timeframe, close_time)` into `trading.signals`, using **upsert** so reruns are idempotent (`signal_agent_id` → `trading.signal_agents.id`).
- **Populate**:
  - `intent`: `trading.signal_intent` enum (`ENTER`, `ADD`, `REDUCE`, `EXIT`, `HOLD`).
  - `reasons`: JSON **array of short strings** (audit / debugging).
  - `metadata`: JSON object (rule version, indicator snapshots, optional `candleSyncRunId` from the candle sweep).
  - `candle_id`: strongly recommended — FK to the `catalog.candles` row for the evaluated bar.
- **Register** the agent in `trading.signal_agents` (migration seed or ops insert) before writing signals — `trading.signals.signal_agent_id` references `trading.signal_agents(id)` (`on delete restrict`). The worker may still copy the slug into `metadata.agent_id` for logs.

---

## Boundaries (must **not** do)

- **No orders** — no Bitvavo order placement, no `trading.orders` / `trading.fills` writes from signal code.
- **No mediator** — do not write `trade_decisions` from a signal agent.
- **No untrusted `user_id`** — workers use the Supabase **service role** and must take `user_id` only from **trusted server configuration**: the **Automated Process** user resolved from `public.automation_actor` (`key = 'automated_process'`), optionally merged with comma-separated **`SIGNAL_USER_IDS`** (extra `auth.users` UUIDs). Never copy `user_id` from unsigned client JSON. See [supabase/RLS-WORKERS.md](../supabase/RLS-WORKERS.md).
- **`ADD` / `REDUCE` / `EXIT` without position context** — v1 rule agents should stick to **`ENTER` vs `HOLD`** where possible; exit-style intents are **safe** at the mediator (denied with clear reason codes until the executor supports exits), but can still add noise in `trading.signals` if emitted carelessly.

---

## Data contract (`trading.signals`)

| Column | Required | Notes |
| --- | --- | --- |
| `user_id` | yes | Trusted env UUID(s); RLS for `authenticated` users still applies to dashboard reads. |
| `signal_agent_id` | yes | UUID FK to `trading.signal_agents.id`. |
| `market_id` | yes | `catalog.markets.id`. |
| `timeframe` | yes | Must match the evaluated series (catalog `15m` in v1). |
| `close_time` | yes | Bar close instant; keep consistent with `candle_timestamps.close_time`. |
| `intent` | yes | Enum literal as string in JS. |
| `confidence` | optional | Numeric or `null`. |
| `reasons` | yes | JSON array (may be `[]`). |
| `metadata` | yes | JSON object (may be `{}`). |
| `candle_id` | recommended | `catalog.candles.id` for the evaluated bar. |

Unique constraint (multi-tenant): `(user_id, signal_agent_id, market_id, timeframe, close_time)` — see `20260527100000_signals_signal_agent_uuid_fk.sql` (replaces the earlier `(user_id, agent_id, …)` unique from `20260526120000_signals_unique_user_seed_agent.sql`).

---

## When signal runs are triggered

- After a **successful** Bitvavo **EUR** candle sweep **finishes** (`incomplete: false`) for the **catalog storage timeframe** (`15m`) and **`candleRowsUpserted > 0`**, `runEurCandleSweep` resolves the **latest** `catalog.candle_timestamps.close_time` and calls `enqueueSignalsCatalogCloseAfterIncremental` once for that bar.
- The candle worker still chooses how to fetch Bitvavo data internally; the signal step does **not** branch on those modes — it always targets the newest closed bar on the shared timestamp grid.
- **Opt-out**: set `SIGNALS_AFTER_CANDLE_DISABLE=1`.
- **No-op** if the automated actor row is missing **and** `SIGNAL_USER_IDS` resolves to no valid users — the worker returns `skippedReason: no_signal_user_ids`.
- **Precedence**: **Automated Process** (DB) is always first when present; **`SIGNAL_USER_IDS`** adds further UUIDs (deduped).

---

## Worker: `POST /api/workers/signals-catalog-close`

- **Auth**: `Authorization: Bearer ${CRON_SECRET}` (see `verifyScheduledWorker`).
- **Body** (JSON): `{ "closeTimeIso": "<ISO>", "timeframe"?: "15m", "quote"?: "EUR", "marketOffset"?: number, "marketBatchSize"?: number, "candleSyncRunId"?: string }`.
- **Behaviour**: records `automation.sync_runs` with job key `signals_catalog_close`, then loads enabled rows from `trading.signal_agents` and runs `runSignalsCatalogCloseDrain` — all Bitvavo EUR markets in **in-process** batches (RPC `bitvavo_markets_for_candle_sync_slice`), upserts signals. After candles, `enqueueSignalsCatalogCloseAfterIncremental` calls the same orchestration.

Implementation entry points:

- [`apps/web/src/lib/signals/run-signals-catalog-close.ts`](../apps/web/src/lib/signals/run-signals-catalog-close.ts)
- [`apps/web/src/lib/signals/run-signals-catalog-close-with-sync-run.ts`](../apps/web/src/lib/signals/run-signals-catalog-close-with-sync-run.ts)
- [`apps/web/src/lib/signals/enqueue-signals-catalog-close.ts`](../apps/web/src/lib/signals/enqueue-signals-catalog-close.ts)
- [`apps/web/src/app/api/workers/signals-catalog-close/route.ts`](../apps/web/src/app/api/workers/signals-catalog-close/route.ts)

---

## Built-in agent: `ma-cross-15m-v1`

- **Type**: rule-based — simple moving averages on **closes**; **ENTER** on bullish crossover at the target bar, **EXIT** on bearish cross-down (P3), else **HOLD**.
- **Config** (`trading.signal_agents.config` JSON): `fastPeriod` (default `9`), `slowPeriod` (default `21`), `minAtrPct` / `maxAtrPct` (volatility gate, see P3 below), `atrPeriod`.
- **Code**: [`apps/web/src/lib/agents/signal/services/ma-cross-eval.service.ts`](../apps/web/src/lib/agents/signal/services/ma-cross-eval.service.ts) (pure functions + unit tests).

---

## Phase 3 (P3) signal stack — regime, volatility, multi-timeframe, SAR

Phase 3 of Trading Framework v2 turns the v1 single-rule pipeline into a small **ensemble of deterministic agents** plus **regime-aware mediator gating** and an automated **Stop-and-Reverse (SAR)** flow. All P3 agents stay deterministic and pure — no AI, no random seeds — so paper / historical replays are reproducible.

### P3 agent roster

| Agent slug | What it does | Intent emitted | Side |
| --- | --- | --- | --- |
| `regime-classifier-15m-v1` | Daily-200 SMA + slope on the close series; tags **bull / bear / sideways** in `metadata.regime`. | Always `HOLD` (informational). | n/a |
| `multi-tf-confluence-15m-v1` | Higher-TF (4h) trend filter via SMA + lower-TF (15m) RSI entry trigger. | `ENTER` long when both align, else `HOLD`. | `long` |
| `ma-cross-15m-v1` | Fast/slow SMA crossover on closes. | `ENTER` on cross-up; `EXIT` on cross-down (P3). | `long` |
| `rsi-reversion-5m-v1` | RSI mean-reversion. | `ENTER` on RSI cross-up from oversold; `EXIT` when RSI cross-down through `overbought` (P3). | `long` |
| `breakout-atr-5m-v1` | Range break > ATR×N. | `ENTER` on qualified break; `EXIT` on breakout-failure cross-down (P3). | `long` |

All P3 agents stamp `signal_side` (`long` / `short`) on `trading.signals`. v1 agents default to `long` for backwards compatibility.

### P3 cross-cutting filters (configurable per agent)

- **Volatility gate** (`minAtrPct`, `maxAtrPct`, optional `atrPeriod`) — applied to **ENTER** intents in all three deterministic entry agents. Skips bars where ATR-as-percentage-of-price falls outside the configured band. Pure helper: [`apps/web/src/lib/markets/atr-volatility-gate.ts`](../apps/web/src/lib/markets/atr-volatility-gate.ts).
- **ADX trend filter**:
  - `rsi-reversion-*` skips ENTER when ADX > `maxAdx` (textbook 25). Mean-reversion is unsafe in strong trends.
  - `breakout-atr-*` skips ENTER when ADX < `minAdx`. Breakouts only have edge inside an established trend.
  - Pure helper: [`apps/web/src/lib/markets/adx.ts`](../apps/web/src/lib/markets/adx.ts).
- **Volume confirmation** (`volumeConfirmationMultiplier`, `volumeLookbackBars`) on `breakout-atr-*` — entries require the bar's volume to exceed `avg(volume over volumeLookbackBars) × multiplier`.

### P3 mediator behaviour

The mediator (`apps/web/src/lib/agents/trade-mediator/services/catalog-close-mediator-run.service.ts`) reads the regime classifier's `metadata.regime` and applies regime-aware gating per executor (`mediator_rails_extra.regimeGatingEnabled`):

- **bull regime** → ENTERs from other agents pass through unchanged.
- **bear regime** → ENTERs are demoted to HOLD with `reason_codes` carrying `regime_demote_*`.
- **sideways regime** → ENTERs are demoted **unless** the `multi-tf-confluence-15m-v1` agent also emitted ENTER on the same bar (multi-timeframe confluence overrides the sideways gate).
- EXIT intents are always preserved.

Implementation helper: [`regime-gating.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/regime-gating.service.ts).

### P3 SAR (Stop-and-Reverse)

When the regime classifier confirms a **flip** across three consecutive bars (`bull→bear→bear` or `bear→bull→bull`), the mediator emits **paired** decisions for the same regime classifier `signal_id` but different `position_side`:

- **EXIT** on the previously open side (only when a position exists).
- **ENTER** on the opposite side (only when that side is in `executor.allowed_sides`).

This pair lives in the same `(user, executor, signal, position_side)` unique window — the migration `20260723110300_decisions_uniqueness_with_position_side.sql` widened the unique index for exactly this purpose.

The executor processes decisions in **EXIT-before-ENTER** order per `(executor, market, bar)` so wallet sequencing stays correct (close the old position → free quote balance → open the new one).

Helpers:

- [`regime-flip-detect.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/regime-flip-detect.service.ts) — pure detection from a 3-point regime sequence.
- [`sar-decision-emit.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/sar-decision-emit.service.ts) — pure proposal emitter (paired EXIT + ENTER).
- [`sar-mediator-run.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/sar-mediator-run.service.ts) — Supabase wiring (fetch previous regime points + open positions, write paired decisions).

### Bitvavo specifics (long-only spot)

`catalog.exchanges` capability flags for Bitvavo are `supports_spot_buy = true`, all others `false`. The executor form refuses `short` checkboxes for Bitvavo executors. SAR on Bitvavo therefore reduces to **EXIT-long only on a confirmed bull→bear flip** (no ENTER-short pair). When/if margin/short capable exchanges are added, SAR will fire the full pair without code changes — only `executor.allowed_sides` and `catalog.exchanges` flags need updating.

### Paper-validation checklist

Before promoting any new P3 config to `live`, validate the full chain on paper executors:

1. Create a paper executor with `execution_mode = 'paper'` and the new agent set (regime classifier + at least one entry agent + multi-tf-confluence on sideways setups).
2. Add **quote-asset budgets** (`trading.executor_quote_asset_budget`) for the markets you care about — without these the mediator skips with reason `quote_asset_not_allowed`.
3. Confirm `catalog.exchanges` flags are right for the target exchange; pick `executor.allowed_sides` to match.
4. Run the historical replay from the executor detail page **Run** button (paper budget defaulted from the historical wallet). Verify:
   - Decisions on confirmed flips show **two rows** with the same `signal_id` and different `position_side`.
   - Orders sequence as **EXIT before ENTER** for the same `(executor, market, bar)`.
   - Demoted ENTERs in bear / sideways regime carry `regime_demote_*` in `reason_codes`.
   - Volatility / volume / ADX skips are visible in `trading.signals.metadata.reasons`.
5. Sanity-check the **wallet ledger** — for paired SAR pairs, the EXIT row credits before the ENTER debits (otherwise the budget check fails on the ENTER).
6. Promote to `live` only after running at least one **rolling 30-day window** end-to-end with no rejected pairs.

To add another `agent_id`, implement an evaluator, register the row in `signal_agents` (see `supabase/migrations/20260723110400_seed_p3_signal_agents.sql` for the upsert pattern), and extend the worker's agent dispatch loop in [`signals-catalog-close-run.service.ts`](../apps/web/src/lib/agents/signal/services/signals-catalog-close-run.service.ts).

---

## Environment variables (summary)

See [apps/web/README.md](../apps/web/README.md#signal-agents-env) for the table. After migrations, **Automated Process** is created automatically; minimum to invoke the worker manually or from a scheduler:

1. `CRON_SECRET`
2. Optional: `SIGNAL_USER_IDS` with extra `auth.users` UUIDs if you need additional pipeline identities beyond the automated actor.

---

## Troubleshooting

- **No rows in `trading.signals`**: confirm `public.automation_actor` has `automated_process`, check optional `SIGNAL_USER_IDS`, confirm EUR `15m` candle sweep completed with new rows (`sync_runs` for `bitvavo_candles_eur`), confirm `trading.signal_agents` has `enabled = true` for `ma-cross-15m-v1`.
- **Upsert errors on unique**: ensure migrations through `20260527100000_signals_signal_agent_uuid_fk.sql` are applied; `onConflict` must match `(user_id, signal_agent_id, market_id, timeframe, close_time)`.
- **Timeouts locally**: lower universe via `SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS`, or raise `SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS` / related env caps.

---

## Instructions for AI coding agents (Cursor)

- Respect **RLS worker rules**: service role writes are allowed, but **scope `user_id` from `getCatalogPipelineUserIds` / automation actor + optional env only**.
- Do **not** place orders or write `trade_decisions` in signal-agent tasks (step 2 scope).
- When changing indicator logic, **update or add unit tests** under `apps/web/src/lib/agents/signal/services/*.test.ts` (and the cross-cutting helpers in `apps/web/src/lib/markets/*.test.ts`); run `pnpm --filter web test` from the repo root.
- For mediator-side / SAR changes, also touch the ensemble suite at `apps/web/src/lib/agents/trade-mediator/services/regime-sar-ensemble.test.ts` so the bull / bear / sideways / flip matrix stays green.
- Prefer **deterministic** rule code for v1; avoid hidden randomness.

---

*Last updated: Signal agents + Trade Mediator (step 3) cross-links.*
