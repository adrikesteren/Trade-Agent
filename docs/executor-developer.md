# Trade Executor — developer guide

This document describes **step 4** in the pipeline: turning **approved** `trading.trade_decisions` into `trading.orders` (and `fills` / `positions`), in **paper** (simulated) or **live** (Bitvavo REST) mode. It complements [how-we-use-agents.md](./how-we-use-agents.md) and [mediator-developer.md](./mediator-developer.md).

Audience: human developers and automation agents editing this repo.

---

## Role in the pipeline

1. Ingest → candles  
2. Signal agents → `trading.signals`  
3. Trade Mediator → `trading.trade_decisions` (one row per **enabled executor** per market/bar; mode-agnostic — paper vs live is only `trading.executors.execution_mode` at order time)  
4. **Executor** (this document) → `trading.orders` (+ `fills`, `positions`) keyed by `executor_id`  
5. **Ops / scheduler** — external cron hitting worker routes with `CRON_SECRET`, live **reconcile** vs Bitvavo, daily risk reset, optional alerts. See [ops-developer.md](./ops-developer.md). (In [how-we-use-agents.md](./how-we-use-agents.md) FAQ table, “stap 5” means executor; the **Rollen** list uses step 5 for Ops — both docs now cross-link.)

The executor **does not** re-run risk logic; it only executes what the mediator already approved (`approved = true` and a `proposedOrder` in `decision_payload`).

---

## Executors (portfolios, Paper / Live, asset filter)

- **`trading.executors`** (RLS per `user_id`): `name`, `enabled`, `execution_mode` (`paper` | `live`), **`asset_filter_mode`** (`all` | `whitelist` | `blacklist`) with **`filter_asset_ids`** (`uuid[]`). DB constraint: whitelist/blacklist modes require a non-empty asset list; `all` uses an empty array. **Mediator policy** on the same row: `default_notional_eur`, risk rail columns (`max_risk_per_trade`, `max_open_positions`, …, `allow_add`), and optional **`mediator_rails_extra`** jsonb — see [mediator-developer.md](./mediator-developer.md). (Legacy column **`budget_eur`** may still exist in the database but is no longer used by the app; spending is limited by **assigned balance** in `risk_state.equity_eur`.)  
- **Trading → Executors** → [`/executors`](../apps/web/src/app/(app)/executors/page.tsx) (detail + PnL snapshot per executor). Legacy **`/settings/execution`** redirects to **`/me/preferences/execution`**, then to Executors.  
- The **mediator** loads **enabled** executors per `SIGNAL_*` user, skips markets outside the executor’s asset filter (via `catalog.markets.asset_id`), reads **`positions`** for `(user_id, executor_id, market_id)`, and writes **mode-agnostic** decisions (`trade_decisions` has no `paper` column).  
- **Live Bitvavo signing** uses **`trading.executors.exchange_api_key`** and **`exchange_api_secret`** (set in Dashboard → Executors → Edit). Optional env **`BITVAVO_OPERATOR_ID`** (default `1`) is still read for Bitvavo `operatorId` on each order. See [apps/web/README.md](../apps/web/README.md).

---

## Executor balance (EUR) — assigned capital

- **`trading.risk_state.equity_eur`** (per `executor_id`) is the **only in-app spendable balance** for that executor: it starts at **0** when `risk_state` is created; users add or remove EUR on the executor detail page (**Add balance** / **Remove balance**), which calls `trading.apply_executor_balance_change` and appends rows to **`trading.executor_balance_ledger`**.
- **Buys** debit **`notional_eur + fill fee`** from `equity_eur` and append a **`trade_buy`** ledger row (idempotent per `orders.id` via `trading.apply_executor_trade_buy_debit`, **service_role** only). The executor worker **skips** a paper buy (or inserts a **rejected** live stub without calling Bitvavo) when `equity_eur` is below that debit. This balance is **not** your Bitvavo account total — it is only what you assign inside Trade Agent.
- **New executors** created from the app default to **`enabled = false`** until the user turns them on (DB default on `executors.enabled` is also `false` after the balance migration).

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

*Last updated: Executor balance + ledger (`executor_balance_ledger`, `risk_state.equity_eur`, RPCs).*
