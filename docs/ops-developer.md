# Ops / scheduler — developer guide

This document is **step 5** in the role model from [how-we-use-agents.md](./how-we-use-agents.md): **worker HTTP routes** and **optional alerting**. It complements [executor-developer.md](./executor-developer.md) (execution + idempotency) and the project brief’s worker topology.

**Numbering note:** In [how-we-use-agents.md](./how-we-use-agents.md) § “Voorbeeld: simpele agents…”, the table uses a **different** step index (there, “stap 5” is the executor). In the main **Rollen** list, step 5 is **Ops** — this file.

---

## Localhost-first

- Develop with `pnpm dev` and repo-root or `apps/web` `.env`.
- **Workers:** `Authorization: Bearer ${CRON_SECRET}` on `GET`/`POST /api/workers/*`. Heavy jobs (EUR candle sweep, signals, CoinGecko) run **inline** in the same Node process until finished or until chunk/time caps in env are hit.
- **Scheduling:** use any cron or task runner (Windows Task Scheduler, systemd timer, GitHub Actions, etc.) that `curl`s the worker URL with the Bearer header. No third-party queue is required.

---

## System settings (`public.system_settings`) and roles (`public.user_profiles`)

- **Precedence:** for keys that exist in `public.system_settings`, the app reads **Postgres first**, then falls back to the matching **`process.env`** variable, then the built-in default (when numeric registry entries exist). Use the **list** at **System settings** (`/system-settings`); open a row for **Edit** (dialog) or **Delete** (confirm). Changes apply on the **next** worker run without restarting `pnpm dev`. Changing only `.env` still requires a **process restart** for variables that are not overridden by a DB row (and monorepo dotenv loads once per Node process anyway).
- **Who can edit:** only users with `public.user_profiles.role = 'administrator'`. New `auth.users` rows get `user_profiles` with role **`user`** via trigger.
- **First administrator (SQL, once per project):** after you can sign in, promote your user (replace the email):

```sql
update public.user_profiles up
set role = 'administrator', updated_at = now()
from auth.users u
where up.user_id = u.id
  and lower(u.email) = lower('you@example.com');
```

---

## Typical worker routes

| Route | Purpose |
|-------|---------|
| `POST /api/workers/bitvavo-candles-sync` | EUR catalog candle sweep (`sync_runs` `bitvavo_candles_eur`) |
| `GET /api/workers/bitvavo-candles-sync` | Same as POST with empty body (Bearer auth) |
| `POST /api/workers/bitvavo-markets-sync` | EUR markets catalog |
| `GET /api/workers/bitvavo-markets-sync` | Same as POST |
| `POST /api/workers/bitvavo-asset-data-sync` | Bitvavo GET `/assets` → `catalog.assets` display name + `metadata.bitvavo` (deposit/withdrawal, decimals, networks; `sync_runs` `bitvavo_asset_data`) |
| `GET /api/workers/bitvavo-asset-data-sync` | Same as POST with empty body (all assets from API that match catalog rows) |
| `POST /api/workers/coingecko-metrics-sync` | CoinGecko metrics |
| `GET /api/workers/coingecko-metrics-sync` | Same as POST with empty body |
| `POST /api/workers/coingecko-coin-id-sync` | CoinGecko coin id backfill |
| `GET /api/workers/coingecko-coin-id-sync` | Same as POST |
| `POST /api/workers/signals-catalog-close` | Signals for one catalog bar (`signals_catalog_close` sync run) |
| `POST /api/workers/mediator-catalog-close` | Mediator (`mediator_catalog_close`) |
| `POST /api/workers/executor-catalog-close` | Executor (`executor_catalog_close`) |
| `GET` or `POST` `/api/workers/symbol-close-pipeline` | Single-asset pipeline: Bitvavo candles + scoped signal/mediator/executor (`sync_runs` `symbol_close_pipeline`). Live CoinGecko metrics: `coingecko-metrics-sync`. |
| `GET` or `POST` `/api/workers/asset-close-pipeline` | Same orchestration and `sync_runs` job key as `symbol-close-pipeline` (optional alias / naming); CoinGecko is not part of either route. |
| `GET` or `POST` `/api/workers/exchange-close-pipeline` | Optional **Relay** ordered fan-out: for an `exchangeCode`, enqueue **`symbol-close-pipeline`** once per distinct catalog `asset.code` in mcap-desc order (default quote EUR). Requires `RELAY_APP_URL`, `RELAY_APP_SECRET`, `APP_URL`, and `CRON_SECRET`. |
| `POST /api/workers/risk-daily-reset` | Reset `trading.risk_state.daily_pnl_eur` (intended once per UTC day) |
| `POST /api/workers/bitvavo-reconcile` | Live order status sync vs Bitvavo |

---

### `GET` or `POST` `/api/workers/exchange-close-pipeline`

- **Query (required):** `exchangeCode` (case-insensitive, matches `catalog.exchanges.code`).
- **Query (optional):** `quote` — defaults to **EUR**; only markets with that quote are considered when collecting distinct base assets.
- **Env:** `RELAY_APP_URL`, `RELAY_APP_SECRET` (Relay ingress Bearer), **`APP_URL`** (this app’s public origin, no trailing slash; used to build worker URLs), **`CRON_SECRET`** (forwarded in Relay job `headers` for each downstream `POST`). Optional `RELAY_EXCHANGE_CLOSE_MAX_RETRIES` (default `2`).
- **Auth:** `Authorization: Bearer ${CRON_SECRET}` on this route only (same as other workers).
- **Flow:** resolve exchange → list markets for the quote → **distinct base assets ordered by `catalog.assets.coingecko_market_cap_usd` descending** (unknown cap last; tie-break `market_symbol`) → **one** `POST` Relay `/api/v1/message-group` with `origin` + `paths` for **all** assets (or `/api/v1/messages` when there is only one asset). Jobs run **strictly in order** within that group on the Relay side. Ensure Relay’s **dispatcher** runs so queued jobs actually execute (see Relay `AGENTS.md`).

---

### `GET` or `POST` `/api/workers/asset-close-pipeline`

- **Query (required):** same as `symbol-close-pipeline` (`assetCode`, `exchangeCode`, optional `quote`).
- **Behaviour:** same as `symbol-close-pipeline` (`runSymbolClosePipeline`). Optional POST JSON: `skipCandles`, `skipSignals`, `skipMediator`, `skipExecutor` (booleans). Same `sync_runs` `symbol_close_pipeline` overlap rules.

### `GET` or `POST` `/api/workers/symbol-close-pipeline`

- **Query (required):** `assetCode`, `exchangeCode` — matched **case-insensitively** against `catalog.assets.code` and `catalog.exchanges.code`.
- **Query (optional):** `quote` — defaults to **EUR**; with asset + exchange resolves exactly one `catalog.markets` row.
- **POST body (optional JSON):** `skipCandles`, `skipSignals`, `skipMediator`, `skipExecutor` — booleans, default `false`.
- **Flow:** resolve market → `sync_runs` row `symbol_close_pipeline` (scoped uniqueness allows **parallel** runs for different `assetCode`+`exchangeCode` pairs) → Bitvavo catalog candles for that market (retention as bulk sync) → in-process signal → mediator → executor for **only** that `market_id` (no full-catalog HTTP enqueue). For CoinGecko `/coins/markets` updates, run `coingecko-metrics-sync` (or related workers) separately.
- **Non-Bitvavo exchanges:** candles and catalog-close trading steps are skipped with clear step errors until multi-exchange support exists.

---

## Workers (auth)

Worker handlers use [verifyScheduledWorker](../apps/web/src/lib/workers/verify-scheduled-worker.ts) (`Authorization: Bearer ${CRON_SECRET}`).

### `POST /api/workers/risk-daily-reset`

- **Service role:** `update trading.risk_state set daily_pnl_eur = 0, updated_at = now()` for every row.
- Intended to run **once per calendar day (UTC)** unless you change your cron; document Amsterdam “trading day” in ops runbooks if you later split intraday vs calendar PnL.

### `POST /api/workers/bitvavo-reconcile`

- **Scope:** `trading.orders` with `paper = false`, `external_id` set, `status` in (`pending`, `open`), joined to `trading.executors` with `execution_mode = 'live'`.
- **Behaviour:** `GET /v2/order` on Bitvavo per order (bounded batch per run); updates `orders.status`, `quantity`, `updated_at`; if Bitvavo reports `filled`, inserts `fills` when missing and **upserts** `positions` (same rules as the live branch in the executor). Does not cancel foreign orders.

Uses each live executor’s **`exchange_api_key` / `exchange_api_secret`** (`trading.executors`). Orders without stored credentials are skipped with an error in the batch result.

---

## Alerts

Optional `OPS_ALERT_WEBHOOK_URL`: server-side `POST` with `Content-Type: application/json` and a small payload `{ "source", "level", "title", "detail", "at" }` on selected worker failures (see [apps/web/src/lib/ops/send-ops-alert.ts](../apps/web/src/lib/ops/send-ops-alert.ts)). Failures to send the webhook are swallowed (log only) so trading paths are not blocked.

Optional `SLACK_TRADE_FILLS_WEBHOOK_URL`: Slack Incoming Webhook; `POST` JSON with **`[Executor]: BUY/SELL - asset - exchange`** (Block Kit attachment: green bar for buy, red for sell) when a trade fill row is written (see [apps/web/src/lib/ops/send-trade-fill-slack.ts](../apps/web/src/lib/ops/send-trade-fill-slack.ts)). Same non-blocking behaviour as ops alerts.

---

## Related docs

- [how-we-use-agents.md](./how-we-use-agents.md) — full pipeline roles.
- [executor-developer.md](./executor-developer.md) — executor idempotency and live/paper behaviour.
- [apps/web/README.md](../apps/web/README.md) — env tables for workers.

---

*Last updated: Ops step 5 — workers via CRON_SECRET, symbol-close-pipeline, optional webhook alerts.*
