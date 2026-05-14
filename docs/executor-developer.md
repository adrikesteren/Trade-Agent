# Trade Executor — developer guide

This document describes **step 4** in the pipeline: turning **approved** `trading.trade_decisions` into `trading.orders` (and `fills` / `positions`), in **paper** (simulated) or **live** (Bitvavo REST) mode. It complements [how-we-use-agents.md](./how-we-use-agents.md) and [mediator-developer.md](./mediator-developer.md).

Audience: human developers and automation agents editing this repo.

---

## Role in the pipeline

1. Ingest → candles  
2. Signal agents → `trading.signals`  
3. Trade Mediator → `trading.trade_decisions` (one row per **enabled executor** per market/bar, excluding `execution_mode = historical` in catalog-close; mode-agnostic otherwise — paper vs live is only `trading.executors.execution_mode` at order time)  
4. **Executor** (this document) → `trading.orders` (+ `fills`, `positions`) keyed by `executor_id`  
5. **Ops / scheduler** — external cron hitting worker routes with `CRON_SECRET`, live **reconcile** vs Bitvavo, daily risk reset, optional alerts. See [ops-developer.md](./ops-developer.md). (In [how-we-use-agents.md](./how-we-use-agents.md) FAQ table, “stap 5” means executor; the **Rollen** list uses step 5 for Ops — both docs now cross-link.)

The executor **does not** re-run risk logic; it only executes what the mediator already approved (`approved = true` and a `proposedOrder` in `decision_payload`).

---

## Executors (portfolios, Paper / Live, asset filter)

- **`trading.executors`** (RLS per `user_id`): `name`, `enabled`, `execution_mode` (`paper` | `live` | `historical`), **`asset_filter_mode`** (`all` | `whitelist` | `blacklist`) with **`filter_asset_ids`** (`uuid[]`). DB constraint: whitelist/blacklist modes require a non-empty asset list; `all` uses an empty array. **Mediator policy** on the same row: risk rail columns (`max_risk_per_trade`, `max_open_positions`, …, `allow_add`) plus optional **`mediator_rails_extra`** jsonb — see [mediator-developer.md](./mediator-developer.md). **Per-quote-asset budgets** live in **`trading.executor_quote_asset_budget`** (junction table, see [AGENTS.md → Wallets and quote-asset budgets](../AGENTS.md#wallets-and-quote-asset-budgets)); the legacy column `default_notional_eur` was removed. Spending limits per executor are enforced both by the per-quote budget (notional cap per order) and by the **assigned balance** on the executor's wallet.  
- **`historical`** mode: `historical_start_date` / `historical_end_date` (`date`, UTC calendar days), **whitelist with exactly one** base asset, **Bitvavo** exchange only, **`slack_trade_notifications_enabled` forced false** in the DB. These executors are **skipped** by `runMediatorCatalogClose` / `runExecutorCatalogClose` during normal **`symbol-close-pipeline`** / catalog-close runs. Use the executor detail **Run** control to ingest candles for the range and replay **signal → mediator → executor** bar-by-bar (paper fills). **Important:** replay upserts **`trading.signals`** for the executor owner’s `user_id` (same uniqueness as live catalog-close), so overlapping backtests can overwrite signal rows for that user and market for past bars.
- **Trading → Executors** → [`/executors`](../apps/web/src/app/(app)/executors/page.tsx) (detail + PnL snapshot per executor). Legacy **`/settings/execution`** redirects to **`/me/preferences/execution`**, then to Executors.  
- The **mediator** loads **enabled** executors per `SIGNAL_*` user, skips markets outside the executor’s asset filter (via `catalog.markets.asset_id`), reads **`positions`** for `(user_id, executor_id, market_id)`, and writes **mode-agnostic** decisions (`trade_decisions` has no `paper` column).  
- **Live Bitvavo signing** uses **`trading.executors.exchange_api_key`** and **`exchange_api_secret`** (set in Dashboard → Executors → Edit). Optional env **`BITVAVO_OPERATOR_ID`** (default `1`) is still read for Bitvavo `operatorId` on each order. See [apps/web/README.md](../apps/web/README.md).

---

## Catalog markets (quote leg)

- `catalog.markets` links **`asset_id`** (base, typically a crypto asset) to **`quote_asset_id`** (the settlement asset for that pair: seeded **fiat** ISO rows such as EUR/USD, or a **crypto** row for quotes like BTC on cross pairs).
- Bitvavo catalog sync skips listings whose quote symbol does not resolve to an existing `catalog.assets` row (see [`apps/web/src/lib/markets/resolve-quote-asset.ts`](../apps/web/src/lib/markets/resolve-quote-asset.ts)).

---

## Executor balance — assigned capital (per asset, per wallet)

- Executors no longer carry a single EUR equity number. Instead, each executor points at a **wallet** via `executors.wallet_id` and the spendable balance for an order is the wallet's per-asset balance for the **market quote asset** (e.g. EUR for `GIGA-EUR`, USDT for `BTC-USDT`).
- For **`paper` and `live`** executors, the wallet is **shared per `(user, exchange)`** (`trading.wallets.kind = 'shared_exchange'`). Multiple executors on Bitvavo for the same user therefore spend from a **single pooled wallet** — deposits, withdrawals, and trade fills all touch one balance per asset.
- For **`historical`** executors, the create-wallet trigger always creates an **isolated `historical_paper`** wallet so backtests can be funded and reset without affecting the user's live/paper books.
- Balance changes flow through three RPCs (signatures unchanged after the v2 refactor; they now resolve the wallet via `executors.wallet_id`):  
  - `trading.apply_wallet_balance_change` — manual deposit/withdrawal from the executor detail balance actions.  
  - `trading.apply_wallet_trade_buy_debit` — debits the **quote asset** by `notional + fee` when a buy fills (idempotent per `orders.id`).  
  - `trading.apply_wallet_trade_sell_credit` — credits the **quote asset** when a sell fills.  
  All three append rows to `trading.wallet_transactions` (the audit ledger). The executor worker **skips** a paper buy (or inserts a **rejected** live stub without calling Bitvavo) when the quote balance is below the required debit.
- New executors default to **`enabled = false`** until the user turns them on; the wallet is created automatically by the `executors_create_wallet` trigger and reused across executors that share the same `(user, exchange)`.

---

## Worker: `POST /api/workers/executor-catalog-close`

- **Auth:** `Authorization: Bearer ${CRON_SECRET}` (`verifyScheduledWorker`).  
- **Body:** same shape as mediator/signal workers (`closeTimeIso`, `timeframe`, `quote`, `marketOffset`, …).  
- **Trigger:** after the **last** `mediator-catalog-close` batch for a bar when `decisionsUpserted > 0`, unless `EXECUTOR_AFTER_MEDIATOR_DISABLE=1`. `enqueueExecutorCatalogCloseAfterMediator` runs an **inline drain** with an `executor_catalog_close` `sync_runs` row.

**Behaviour (v1):**

- For each configured `user_id`, each **enabled** executor, and each market in the batch: skip if the market’s base **`asset_id`** is excluded by the executor’s whitelist/blacklist; load the `trade_decision` for `(user_id, executor_id, market_id, timeframe, close_time)`.  
- If `approved`, payload has a **buy** `proposedOrder`, **`risk_state.equity_eur`** is at least **notional + estimated paper fee** (0.25% of notional for the pre-check on live), and there is **no** `orders` row for that `decision_id` yet (partial unique index on `decision_id`):  
  - **Paper executor (`executors.execution_mode = paper`):** use catalog candle **close** at that bar as fill price; insert `orders` (`status=filled`, `executor_id`), one `fills` row, upsert `positions` for `(user_id, executor_id, market_id)` with `orders.paper` / `positions.paper` true; then debit balance + ledger via `apply_executor_trade_buy_debit` (rollback order/fill/position if that debit fails).  
  - **Live executor:** if balance pre-check fails, insert `orders` with `status=rejected` and skip Bitvavo. Otherwise `POST /v2/order` (market buy with `amountQuote` = EUR notional). On success insert `orders` with `executor_id` and `external_id`; if Bitvavo returns `filled` and fill data, insert `fills` and update `positions` with `paper=false`, then debit `notional + actual fee`. On failure insert `orders` with `status=rejected` (best-effort; duplicate errors ignored).

Entry points:

- [`apps/web/src/lib/executor/run-executor-catalog-close.ts`](../apps/web/src/lib/executor/run-executor-catalog-close.ts)  
- [`apps/web/src/lib/executor/enqueue-executor-catalog-close.ts`](../apps/web/src/lib/executor/enqueue-executor-catalog-close.ts)  
- [`apps/web/src/app/api/workers/executor-catalog-close/route.ts`](../apps/web/src/app/api/workers/executor-catalog-close/route.ts)  
- Bitvavo signing: [`apps/web/src/lib/bitvavo/signed-request.ts`](../apps/web/src/lib/bitvavo/signed-request.ts), [`place-market-order.ts`](../apps/web/src/lib/bitvavo/place-market-order.ts)

---

## Idempotency

- `CREATE UNIQUE INDEX … ON trading.orders (decision_id) WHERE decision_id IS NOT NULL` — at most **one** order per decision (decisions are scoped per executor, so the same bar may produce multiple decisions/orders across executors).

---

## Boundaries

- **No** new trading decisions from the executor.  
- **No** unsigned `user_id` — workers use env-configured users only.  
- **Reconciliation:** v1 worker `POST /api/workers/bitvavo-reconcile` (scheduled) syncs open/pending live orders against Bitvavo; see [ops-developer.md](./ops-developer.md). When a **filled** buy gets its first `fills` row here, the same **`apply_executor_trade_buy_debit`** runs so balance stays in sync for late-filled live orders.

---

## P3: position sides + EXIT-before-ENTER ordering

- The executor reads `decision_payload.proposedOrder.positionSide` (with `decision_payload.positionSide` as fallback) and rejects orders whose side is **not** in `executor.allowed_sides`. The reject row is written with `status='rejected'` and `position_side` so the UI can surface it.
- **Short** is framework-only in P2 — every short proposal is rejected with reason code `short_execution_not_implemented` (no Bitvavo / live calls).
- For Phase 3 SAR pairs, the mediator may write **two** decisions for the same `(executor, market, bar)` keyed on different `position_side` (one EXIT, one ENTER). The executor sorts candidates **EXIT-first, then by id** before processing — see [`exitFirstRank`](../apps/web/src/lib/agents/executor/services/catalog-close-executor-run.service.ts) in `catalog-close-executor-run.service.ts` and the unit tests in [`catalog-close-executor-decision-order.test.ts`](../apps/web/src/lib/agents/executor/services/catalog-close-executor-decision-order.test.ts). This guarantees the EXIT credits the wallet before the ENTER tries to debit, so the SAR pair survives the per-quote balance pre-check.

---

*Last updated: Executor balance + ledger (`executor_balance_ledger`, `risk_state.equity_eur`, RPCs).*
