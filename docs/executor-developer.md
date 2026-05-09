# Trade Executor — developer guide

This document describes **step 4** in the pipeline: turning **approved** `trading.trade_decisions` into `trading.orders` (and `fills` / `positions`), in **paper** (simulated) or **live** (Bitvavo REST) mode. It complements [how-we-use-agents.md](./how-we-use-agents.md) and [mediator-developer.md](./mediator-developer.md).

Audience: human developers and automation agents editing this repo.

---

## Role in the pipeline

1. Ingest → candles  
2. Signal agents → `trading.signals`  
3. Trade Mediator → `trading.trade_decisions` (one row per **enabled executor** per market/bar; mode-agnostic — paper vs live is only `trading.executors.execution_mode` at order time)  
4. **Executor** (this document) → `trading.orders` (+ `fills`, `positions`) keyed by `executor_id`  
5. Ops / reconciliation (future hardening)

The executor **does not** re-run risk logic; it only executes what the mediator already approved (`approved = true` and a `proposedOrder` in `decision_payload`).

---

## Executors (portfolios, Paper / Live, budget, asset filter)

- **`trading.executors`** (RLS per `user_id`): `name`, `enabled`, `execution_mode` (`paper` | `live`), optional **`budget_eur`** (cap on cumulative **filled buy** `orders.notional_eur` for that executor), **`asset_filter_mode`** (`all` | `whitelist` | `blacklist`) with **`filter_asset_ids`** (`uuid[]`). DB constraint: whitelist/blacklist modes require a non-empty asset list; `all` uses an empty array.  
- Dashboard: **Trading → Executors** → [`/dashboard/executors`](../apps/web/src/app/dashboard/executors/page.tsx) (detail + PnL snapshot per executor). Legacy **`/dashboard/settings/execution`** redirects here.  
- The **mediator** loads **enabled** executors per `SIGNAL_*` user, skips markets outside the executor’s asset filter (via `catalog.markets.asset_id`), reads **`positions`** for `(user_id, executor_id, market_id)`, and writes **mode-agnostic** decisions (`trade_decisions` has no `paper` column).  
- **Live Bitvavo keys** are **not** in the database: use server env `BITVAVO_API_KEY` / `BITVAVO_API_SECRET` (and optional `BITVAVO_OPERATOR_ID`, default `1`). See [apps/web/README.md](../apps/web/README.md).

---

## Worker: `POST /api/workers/executor-catalog-close`

- **Auth:** same as other workers — QStash signature or `Authorization: Bearer ${CRON_SECRET}` (`verifyScheduledWorker`).  
- **Body:** same shape as mediator/signal workers (`closeTimeIso`, `timeframe`, `quote`, `marketOffset`, …).  
- **Trigger:** after the **last** `mediator-catalog-close` batch for a bar when `decisionsUpserted > 0`, unless `EXECUTOR_AFTER_MEDIATOR_DISABLE=1`. Without QStash, `enqueueExecutorCatalogCloseAfterMediator` runs an **inline drain**.

**Behaviour (v1):**

- For each configured `user_id`, each **enabled** executor, and each market in the batch: skip if the market’s base **`asset_id`** is excluded by the executor’s whitelist/blacklist; load the `trade_decision` for `(user_id, executor_id, market_id, timeframe, close_time)`.  
- If `approved`, payload has a **buy** `proposedOrder`, optional **budget** still allows the trade (`filled` notional sum + proposed ≤ `budget_eur` when set), and there is **no** `orders` row for that `decision_id` yet (partial unique index on `decision_id`):  
  - **Paper executor (`executors.execution_mode = paper`):** use catalog candle **close** at that bar as fill price; insert `orders` (`status=filled`, `executor_id`), one `fills` row, upsert `positions` for `(user_id, executor_id, market_id)` with `orders.paper` / `positions.paper` true.  
  - **Live executor:** `POST /v2/order` (market buy with `amountQuote` = EUR notional). On success insert `orders` with `executor_id` and `external_id`; if Bitvavo returns `filled` and fill data, insert `fills` and update `positions` with `paper=false`. On failure insert `orders` with `status=rejected` (best-effort; duplicate errors ignored).

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
- **Reconciliation** of open live orders is not fully implemented; expect a follow-up job for drift and partial fills.

---

*Last updated: Executor step 4 + multi-executor portfolios (`trading.executors`).*
