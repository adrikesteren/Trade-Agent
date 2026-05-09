# Trade Executor — developer guide

This document describes **step 4** in the pipeline: turning **approved** `trading.trade_decisions` into `trading.orders` (and `fills` / `positions`), in **paper** (simulated) or **live** (Bitvavo REST) mode. It complements [how-we-use-agents.md](./how-we-use-agents.md) and [mediator-developer.md](./mediator-developer.md).

Audience: human developers and automation agents editing this repo.

---

## Role in the pipeline

1. Ingest → candles  
2. Signal agents → `trading.signals`  
3. Trade Mediator → `trading.trade_decisions` (includes `paper` snapshot from user preference)  
4. **Executor** (this document) → `trading.orders` (+ `fills`, `positions`)  
5. Ops / reconciliation (future hardening)

The executor **does not** re-run risk logic; it only executes what the mediator already approved (`approved = true` and a `proposedOrder` in `decision_payload`).

---

## Execution mode (Paper / Live)

- Stored per user in **`trading.user_execution_preferences.execution_mode`** (`paper` | `live`), RLS-scoped to `auth.uid()`.  
- Dashboard: **Trading → Execution mode** → [`/dashboard/settings/execution`](../apps/web/src/app/dashboard/settings/execution/page.tsx).  
- The **mediator** reads this row (via service role for configured `SIGNAL_*` users) and sets `trade_decisions.paper` to match at decision time.  
- **Live Bitvavo keys** are **not** in the database: use server env `BITVAVO_API_KEY` / `BITVAVO_API_SECRET` (and optional `BITVAVO_OPERATOR_ID`, default `1`). See [apps/web/README.md](../apps/web/README.md).

---

## Worker: `POST /api/workers/executor-catalog-close`

- **Auth:** same as other workers — QStash signature or `Authorization: Bearer ${CRON_SECRET}` (`verifyScheduledWorker`).  
- **Body:** same shape as mediator/signal workers (`closeTimeIso`, `timeframe`, `quote`, `marketOffset`, …).  
- **Trigger:** after the **last** `mediator-catalog-close` batch for a bar when `decisionsUpserted > 0`, unless `EXECUTOR_AFTER_MEDIATOR_DISABLE=1`. Without QStash, `enqueueExecutorCatalogCloseAfterMediator` runs an **inline drain**.

**Behaviour (v1):**

- For each configured `user_id` and each market in the batch, load the `trade_decision` for that bar.  
- If `approved`, payload has a **buy** `proposedOrder`, and there is **no** `orders` row with `decision_id` yet (partial unique index on `decision_id`):  
  - **Paper (`trade_decisions.paper = true`):** use catalog candle **close** at that bar as fill price; insert `orders` (`status=filled`), one `fills` row, upsert `positions` for `(user_id, market_id, paper=true)`.  
  - **Live (`paper = false`):** `POST /v2/order` (market buy with `amountQuote` = EUR notional). On success insert `orders` with `external_id`; if Bitvavo returns `filled` and fill data, insert `fills` and update `positions` for `paper=false`. On failure insert `orders` with `status=rejected` (best-effort; duplicate errors ignored).

Entry points:

- [`apps/web/src/lib/executor/run-executor-catalog-close.ts`](../apps/web/src/lib/executor/run-executor-catalog-close.ts)  
- [`apps/web/src/lib/executor/enqueue-executor-catalog-close.ts`](../apps/web/src/lib/executor/enqueue-executor-catalog-close.ts)  
- [`apps/web/src/app/api/workers/executor-catalog-close/route.ts`](../apps/web/src/app/api/workers/executor-catalog-close/route.ts)  
- Bitvavo signing: [`apps/web/src/lib/bitvavo/signed-request.ts`](../apps/web/src/lib/bitvavo/signed-request.ts), [`place-market-order.ts`](../apps/web/src/lib/bitvavo/place-market-order.ts)

---

## Idempotency

- `CREATE UNIQUE INDEX … ON trading.orders (decision_id) WHERE decision_id IS NOT NULL` — at most **one** order per decision.

---

## Boundaries

- **No** new trading decisions from the executor.  
- **No** unsigned `user_id` — workers use env-configured users only.  
- **Reconciliation** of open live orders is not fully implemented; expect a follow-up job for drift and partial fills.

---

*Last updated: Executor step 4 + execution preferences.*
