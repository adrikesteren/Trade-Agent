# Ops / scheduler — developer guide

This document is **step 5** in the role model from [how-we-use-agents.md](./how-we-use-agents.md): **worker HTTP routes**, optional **Upstash Redis** (locks / idempotency), and **optional alerting**. It complements [executor-developer.md](./executor-developer.md) (execution + idempotency) and the project brief’s worker topology.

**Numbering note:** In [how-we-use-agents.md](./how-we-use-agents.md) § “Voorbeeld: simpele agents…”, the table uses a **different** step index (there, “stap 5” is the executor). In the main **Rollen** list, step 5 is **Ops** — this file.

---

## Localhost-first

- Develop with `pnpm dev` and repo-root or `apps/web` `.env`.
- **Workers:** `Authorization: Bearer ${CRON_SECRET}` on `GET`/`POST /api/workers/*`. Heavy jobs (EUR candle sweep, signals, CoinGecko) run **inline** in the same Node process until finished or until chunk/time caps in env are hit.
- **Scheduling:** use any cron or task runner (Windows Task Scheduler, systemd timer, GitHub Actions, etc.) that `curl`s the worker URL with the Bearer header. No third-party queue is required.

---

## Typical worker routes

| Route | Purpose |
|-------|---------|
| `POST /api/workers/bitvavo-candles-sync` | EUR catalog candle sweep (`sync_runs` `bitvavo_candles_eur`) |
| `GET /api/workers/bitvavo-candles-sync` | Same as POST with empty body (Bearer auth) |
| `POST /api/workers/bitvavo-markets-sync` | EUR markets catalog |
| `GET /api/workers/bitvavo-markets-sync` | Same as POST |
| `POST /api/workers/coingecko-metrics-sync` | CoinGecko metrics |
| `GET /api/workers/coingecko-metrics-sync` | Same as POST with empty body |
| `POST /api/workers/coingecko-coin-id-sync` | CoinGecko coin id backfill |
| `GET /api/workers/coingecko-coin-id-sync` | Same as POST |
| `POST /api/workers/signals-catalog-close` | Signals for one catalog bar (`signals_catalog_close` sync run) |
| `POST /api/workers/mediator-catalog-close` | Mediator (`mediator_catalog_close`) |
| `POST /api/workers/executor-catalog-close` | Executor (`executor_catalog_close`) |
| `GET` or `POST` `/api/workers/symbol-close-pipeline` | Single-asset pipeline: CoinGecko + Bitvavo candles + scoped signal/mediator/executor (`sync_runs` `symbol_close_pipeline`) |
| `POST /api/workers/risk-daily-reset` | Reset `trading.risk_state.daily_pnl_eur` (intended once per UTC day) |
| `POST /api/workers/bitvavo-reconcile` | Live order status sync vs Bitvavo |

---

### `GET` / `POST /api/workers/symbol-close-pipeline`

- **Query (required):** `assetCode`, `exchangeCode` — matched **case-insensitively** against `catalog.assets.code` and `catalog.exchanges.code`.
- **Query (optional):** `quote` — defaults to **EUR**; with asset + exchange resolves exactly one `catalog.markets` row.
- **POST body (optional JSON):** `skipCoingecko`, `skipCandles`, `skipSignals`, `skipMediator`, `skipExecutor` — booleans, default `false`.
- **Flow:** resolve market → `sync_runs` row `symbol_close_pipeline` (scoped uniqueness allows **parallel** runs for different `assetCode`+`exchangeCode` pairs) → CoinGecko `/coins/markets` for that asset only → Bitvavo catalog candles for that market (retention as bulk sync) → in-process signal → mediator → executor for **only** that `market_id` (no full-catalog HTTP enqueue).
- **Non-Bitvavo exchanges:** CoinGecko may still run; candles and catalog-close trading steps are skipped with clear step errors until multi-exchange support exists.

---

## Workers (auth)

All worker handlers use [verifyScheduledWorker](../apps/web/src/lib/workers/verify-scheduled-worker.ts): **`Authorization: Bearer ${CRON_SECRET}`** only.

### `POST /api/workers/risk-daily-reset`

- **Service role:** `update trading.risk_state set daily_pnl_eur = 0, updated_at = now()` for every row.
- Intended to run **once per calendar day (UTC)** unless you change your cron; document Amsterdam “trading day” in ops runbooks if you later split intraday vs calendar PnL.

### `POST /api/workers/bitvavo-reconcile`

- **Redis:** If `UPSTASH_REDIS_REST_*` is set, acquires lock `lock:bitvavo-reconcile` (TTL from `BITVAVO_RECONCILE_LOCK_TTL_MS`, default 9 minutes). If the lock is not acquired, returns `200` with `skipped: lock_not_acquired` so an external scheduler does not treat the run as a hard failure.
- **Scope:** `trading.orders` with `paper = false`, `external_id` set, `status` in (`pending`, `open`), joined to `trading.executors` with `execution_mode = 'live'`.
- **Behaviour:** `GET /v2/order` on Bitvavo per order (bounded batch per run); updates `orders.status`, `quantity`, `updated_at`; if Bitvavo reports `filled`, inserts `fills` when missing and **upserts** `positions` (same rules as the live branch in the executor). Does not cancel foreign orders.

Requires `BITVAVO_API_KEY` / `BITVAVO_API_SECRET`.

---

## Redis (`@repo/redis`)

Package: [packages/redis/src/index.ts](../packages/redis/src/index.ts) — `createRedis()`, `acquireLock`, `releaseLock`, `idempotentOnce`.

If env is missing, `createRedis()` returns `null`; reconcile **skips the lock** and still runs (best-effort). Prefer setting Redis in production so only one reconcile runs at a time.

---

## Alerts

Optional `OPS_ALERT_WEBHOOK_URL`: server-side `POST` with `Content-Type: application/json` and a small payload `{ "source", "level", "title", "detail", "at" }` on selected worker failures (see [apps/web/src/lib/ops/send-ops-alert.ts](../apps/web/src/lib/ops/send-ops-alert.ts)). Failures to send the webhook are swallowed (log only) so trading paths are not blocked.

Optional `SLACK_TRADE_FILLS_WEBHOOK_URL`: Slack Incoming Webhook; `POST` JSON `{ "text": "…" }` when a trade fill row is written for an executor (see [apps/web/src/lib/ops/send-trade-fill-slack.ts](../apps/web/src/lib/ops/send-trade-fill-slack.ts)). Same non-blocking behaviour as ops alerts.

---

## Related docs

- [how-we-use-agents.md](./how-we-use-agents.md) — full pipeline roles.
- [executor-developer.md](./executor-developer.md) — executor idempotency and live/paper behaviour.
- [apps/web/README.md](../apps/web/README.md) — env tables for workers.

---

*Last updated: Ops step 5 — workers via CRON_SECRET, symbol-close-pipeline, Redis lock on reconcile, optional webhook alerts.*
