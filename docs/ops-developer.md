# Ops / scheduler — developer guide

This document is **step 5** in the role model from [how-we-use-agents.md](./how-we-use-agents.md): **QStash schedules**, optional **Upstash Redis** (locks / idempotency), and **optional alerting**. It complements [executor-developer.md](./executor-developer.md) (execution + idempotency) and the project brief’s worker topology.

**Numbering note:** In [how-we-use-agents.md](./how-we-use-agents.md) § “Voorbeeld: simpele agents…”, the table uses a **different** step index (there, “stap 5” is the executor). In the main **Rollen** list, step 5 is **Ops** — this file.

---

## Localhost-first

- Develop with `pnpm dev` and repo-root or `apps/web` `.env`.
- **Manual workers:** `Authorization: Bearer ${CRON_SECRET}` on `POST /api/workers/*` (same as other workers).
- **QStash:** recurring schedules call your **public https** origin (`APP_BASE_URL` / `NEXT_PUBLIC_APP_URL`). For local machines, use a tunnel (e.g. ngrok) and run `pnpm qstash:schedules` from `apps/web` so Upstash hits that URL. Signing: `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, and `ALLOW_INSECURE_QSTASH=1` only for trusted local experiments — see [apps/web/README.md](../apps/web/README.md).

---

## Managed QStash schedules

Script: [apps/web/scripts/qstash-schedules.mjs](../apps/web/scripts/qstash-schedules.mjs)  
Stable IDs + `jobKey` labels: [apps/web/src/lib/workers/qstash-managed-schedules.ts](../apps/web/src/lib/workers/qstash-managed-schedules.ts)  
Dashboard (pause/resume): authenticated `GET`/`POST` [apps/web/src/app/api/dashboard/qstash-schedules/route.ts](../apps/web/src/app/api/dashboard/qstash-schedules/route.ts).

| Schedule ID | Route | Purpose |
|-------------|-------|---------|
| `trade-agent-bitvavo-candles-eur` | `POST /api/workers/bitvavo-candles-sync` | EUR catalog candle sweep |
| `trade-agent-bitvavo-markets-eur` | `POST /api/workers/bitvavo-markets-sync` | EUR markets catalog |
| `trade-agent-coingecko-metrics` | `POST /api/workers/coingecko-metrics-sync` | CoinGecko metrics |
| `trade-agent-coingecko-coin-id` | `POST /api/workers/coingecko-coin-id-sync` | CoinGecko coin id backfill |
| `trade-agent-risk-daily-reset` | `POST /api/workers/risk-daily-reset` | Reset `trading.risk_state.daily_pnl_eur` (UTC day boundary by default) |
| `trade-agent-bitvavo-reconcile` | `POST /api/workers/bitvavo-reconcile` | Live order status sync vs Bitvavo |

Cron overrides (UTC, QStash): `QSTASH_DEFAULT_CRON`, per-job `QSTASH_CRON_BITVAVO_*`, `QSTASH_CRON_COINGECKO_*`, `QSTASH_CRON_RISK_DAILY_RESET` (default `0 0 * * *`), `QSTASH_CRON_BITVAVO_RECONCILE` (inherits default `*/5 * * * *` unless set).

---

## Workers (auth)

All worker `POST` handlers use [verifyScheduledWorker](../apps/web/src/lib/workers/verify-scheduled-worker.ts): valid **QStash signature** on the raw body, or `Authorization: Bearer ${CRON_SECRET}`.

### `POST /api/workers/risk-daily-reset`

- **Service role:** `update trading.risk_state set daily_pnl_eur = 0, updated_at = now()` for every row.
- Intended to run **once per calendar day (UTC)** unless you change cron; document Amsterdam “trading day” in ops runbooks if you later split intraday vs calendar PnL.

### `POST /api/workers/bitvavo-reconcile`

- **Redis:** If `UPSTASH_REDIS_REST_*` is set, acquires lock `lock:bitvavo-reconcile` (TTL from `BITVAVO_RECONCILE_LOCK_TTL_MS`, default 9 minutes). If the lock is not acquired, returns `200` with `skipped: lock_not_acquired` so QStash does not retry endlessly.
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

*Last updated: Ops step 5 — risk reset + reconcile schedules, Redis lock on reconcile, optional webhook alerts.*
