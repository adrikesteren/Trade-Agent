This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

**Supabase auth on localhost with multiple apps:** if another Next.js app on the same machine uses the same Supabase project (same `NEXT_PUBLIC_SUPABASE_URL`), give each app a unique `cookieOptions.name` on every `@supabase/ssr` client and use `signOut({ scope: "local" })` for logout. This app uses `src/lib/supabase/auth-cookie.ts` (`trade-sb-auth`). Browsers share one cookie jar per hostname, not per port.

**HTTP 431 in Chrome:** that means the request headers (usually cookies) exceed the server limit. After renaming cookies or running several Supabase apps on `localhost`, old `sb-*` cookies may still be present alongside `trade-sb-auth` / other apps — clear site data for `http://localhost:3000` (Application → Storage → Clear site data, or delete `localhost` cookies). The `dev` / `start` scripts run Node with a larger `--max-http-header-size` so normal multi-cookie dev still fits; clearing stale cookies is still the right long-term fix.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Hosting

This monorepo is developed **localhost-first** (see repo root `.cursor/rules`). Run production however you prefer (Docker, PM2, your own server); worker routes use `Authorization: Bearer ${CRON_SECRET}` on `GET`/`POST /api/workers/*`.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Signal agents (env)

After a successful Bitvavo EUR catalog candle sweep (`15m`) with new candle rows, the app runs the signals pipeline (including `POST /api/workers/signals-catalog-close` logic inline) so rule-based agents write rows to `trading.signals` (FK `signal_agent_id` → `trading.signal_agents`). See [docs/signal-agents-developer.md](../../docs/signal-agents-developer.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SIGNAL_DEFAULT_USER_ID` | Yes (recommended) | Your `auth.users` UUID for `trading.signals` (trusted server env; typical single-user setup). |
| `SIGNAL_USER_IDS` | Optional | Comma-separated UUIDs; used **only** when `SIGNAL_DEFAULT_USER_ID` is unset (legacy multi-user). |
| `SIGNALS_AFTER_CANDLE_DISABLE` | Optional | Set to `1` to skip enqueueing signal runs after candle sync. |
| `SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE` | Optional | Markets processed per worker invocation (default `40`). |
| `SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS` | Optional | Cap total markets across the whole run (default: all EUR Bitvavo markets). |
| `SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS` | Optional | Max market batches per in-process drain for signals/mediator/executor (default `400`). |

After candles, signals → mediator → executor run **inline** in the same Node process (each stage records `automation.sync_runs`). Raise `SIGNALS_CATALOG_CLOSE_*` / `BITVAVO_CANDLES_SYNC_INLINE_*` if you hit timeouts on a large universe.

Manual worker call (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/signals-catalog-close" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -H "Content-Type: application/json" ^
  -d "{\"closeTimeIso\":\"2026-05-09T12:00:00.000Z\"}"
```

## Trade mediator (env)

After the **last** batch of `signals-catalog-close` for a closed catalog bar (when at least one signal row was upserted), the app enqueues `POST /api/workers/mediator-catalog-close`, which reads `trading.signals`, `trading.executors` (enabled rows per user; **rails + default notional live on each executor row**), `trading.positions` and **`trading.risk_state` per executor**, then **upserts** `trading.trade_decisions` (unique per `user_id`, `executor_id`, `market_id`, `timeframe`, `close_time`). See [docs/mediator-developer.md](../../docs/mediator-developer.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS` | Same as signal agents | Users for whom decisions are written (trusted env only). |
| `MEDIATOR_AFTER_SIGNALS_DISABLE` | Optional | Set to `1` to skip enqueueing the mediator after the signal pass. |
| `SIGNALS_CATALOG_CLOSE_*` | Optional | Same batch caps as the signal worker (`MARKET_BATCH_SIZE`, `MAX_TOTAL_MARKETS`, `INLINE_MAX_ITERS`). |

Mediator risk rails and default EUR notional are edited per executor in the dashboard (**Trading → Executors**), not via env.

Manual worker call (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/mediator-catalog-close" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -H "Content-Type: application/json" ^
  -d "{\"closeTimeIso\":\"2026-05-09T12:00:00.000Z\"}"
```

## Trade executor (env)

After the **last** batch of `mediator-catalog-close` for a bar (when `decisionsUpserted > 0`), the app enqueues `POST /api/workers/executor-catalog-close`, which turns **approved** `trading.trade_decisions` into `trading.orders` (+ `fills` / `positions`) with **`executor_id`**. Paper vs live follows **`trading.executors.execution_mode`** at execution time (decisions are mode-agnostic). Buys require sufficient **assigned EUR balance** (`risk_state.equity_eur`); **asset whitelist/blacklist** is enforced in the mediator (filter). See [docs/executor-developer.md](../../docs/executor-developer.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS` | Same as signal agents | Users whose decisions are executed (trusted env only). |
| `EXECUTOR_AFTER_MEDIATOR_DISABLE` | Optional | Set to `1` to skip enqueueing the executor after the mediator pass. |
| `BITVAVO_API_KEY` / `BITVAVO_API_SECRET` | Required for **live** orders | Server-side Bitvavo signing (never commit; not stored in Postgres). |
| `BITVAVO_OPERATOR_ID` | Optional | Integer `operatorId` on each Bitvavo order (default `1`). |
| `SIGNALS_CATALOG_CLOSE_*` | Optional | Same batch caps as other catalog workers. |

**Executors (UI):** logged-in users manage portfolios under Dashboard → Trading → **Executors** (`/executors`): paper/live per executor, **Add/remove balance** (assigned EUR), enable/disable, and mutually exclusive asset filter (`all` / whitelist / blacklist). Legacy `/settings` and `/settings/execution` redirect to `/me/preferences` (and execution stub → Executors).

Manual worker call (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/executor-catalog-close" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -H "Content-Type: application/json" ^
  -d "{\"closeTimeIso\":\"2026-05-09T12:00:00.000Z\"}"
```

## Ops / scheduler (alerts)

Background jobs for **daily risk reset** and **live order reconciliation**, plus an optional **failure webhook**. Schedule them with any cron hitting the worker URLs (Bearer `CRON_SECRET`). See [docs/ops-developer.md](../../docs/ops-developer.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | Recommended | Bearer secret for `GET`/`POST /api/workers/*`. |
| `OPS_ALERT_WEBHOOK_URL` | Optional | `POST` JSON on hard failures (e.g. candle/markets sync throws, risk reset throws, reconcile throws). |
| `SLACK_TRADE_FILLS_WEBHOOK_URL` | Optional | Slack Incoming Webhook URL; posts a compact **BUY/SELL — asset — signal agent** notification (colored attachment bar) when an executor fill is persisted (`executor-catalog-close` or `bitvavo-reconcile`). Never committed; see [docs/ops-developer.md](../../docs/ops-developer.md). |
| `BITVAVO_RECONCILE_BATCH` | Optional | Max live orders examined per run (default `40`). |

## Relay (optional)

When `RELAY_APP_URL`, `RELAY_APP_SECRET`, `APP_URL`, and `CRON_SECRET` are set, `GET`/`POST /api/workers/exchange-close-pipeline` enqueues an ordered **`symbol-close-pipeline`** job per distinct catalog asset (mcap descending) on your **Relay** instance via `POST /api/v1/message-group` (or `/api/v1/messages` when there is only one asset). See the Relay repository’s `AGENTS.md` for ingress auth and payload shape. Relay’s **dispatcher** must run periodically (`GET` or `POST` `{RELAY_APP_URL}/api/internal/dispatch` with dispatcher auth, or Relay’s bundled worker); otherwise jobs stay pending. Optional `RELAY_EXCHANGE_CLOSE_MAX_RETRIES` (default `2`) is passed through as `maxRetries`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `RELAY_APP_URL` | For Relay fan-out | Relay app origin, e.g. `http://localhost:1337` (no trailing slash). |
| `RELAY_APP_SECRET` | For Relay fan-out | Bearer for Relay `POST /api/v1/messages` and `/api/v1/message-group` (server-only). |
| `APP_URL` | For Relay fan-out | Public origin of **this** Next app; worker URLs in Relay jobs point here (e.g. `http://localhost:3000`). |
| `CRON_SECRET` | For Relay fan-out | Same Bearer workers already use; included in Relay job `headers` so each `symbol-close-pipeline` call is authorized. |
| `RELAY_EXCHANGE_CLOSE_MAX_RETRIES` | Optional | Per-job `maxRetries` for Relay (default `2`, max `100`). |

Manual worker calls (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/risk-daily-reset" ^
  -H "Authorization: Bearer %CRON_SECRET%"

curl -sS -X POST "http://localhost:3000/api/workers/bitvavo-reconcile" ^
  -H "Authorization: Bearer %CRON_SECRET%"
```
