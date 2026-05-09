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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Hosting

This monorepo is developed **localhost-first** (see repo root `.cursor/rules`). Run production however you prefer (Docker, PM2, your own server); worker routes use `CRON_SECRET` / QStash like any other Next host.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Signal agents (env)

After a successful Bitvavo EUR catalog candle sweep (`5m`) with new candle rows, the app can enqueue `POST /api/workers/signals-catalog-close` so rule-based agents write rows to `trading.signals` (FK `signal_agent_id` → `trading.signal_agents`). See [docs/signal-agents-developer.md](../../docs/signal-agents-developer.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SIGNAL_DEFAULT_USER_ID` | Yes (unless `SIGNAL_USER_IDS`) | Single `auth.users` UUID to attach `trading.signals` rows to (trusted server env only). |
| `SIGNAL_USER_IDS` | Optional | Comma-separated UUIDs; when set, overrides `SIGNAL_DEFAULT_USER_ID` and writes one signal per user per market/agent/bar. |
| `SIGNALS_AFTER_CANDLE_DISABLE` | Optional | Set to `1` to skip enqueueing signal runs after candle sync. |
| `SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE` | Optional | Markets processed per worker invocation (default `40`). |
| `SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS` | Optional | Cap total markets across the whole run (default: all EUR Bitvavo markets). |
| `SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS` | Optional | Max batches when QStash is **not** configured (dev drain loop, default `400`). |

When `APP_BASE_URL` (or `NEXT_PUBLIC_APP_URL`) **and** `QSTASH_TOKEN` are set, follow-up batches self-chain like the Bitvavo candle worker. Otherwise the enqueue step runs an **inline drain** loop in the same process (localhost-friendly; watch timeouts on large universes).

Manual worker call (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/signals-catalog-close" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -H "Content-Type: application/json" ^
  -d "{\"closeTimeIso\":\"2026-05-09T12:00:00.000Z\"}"
```

## Trade mediator (env)

After the **last** batch of `signals-catalog-close` for a closed catalog bar (when at least one signal row was upserted), the app enqueues `POST /api/workers/mediator-catalog-close`, which reads `trading.signals`, `trading.positions` (paper), and `trading.risk_state` per configured user and **upserts** `trading.trade_decisions` (unique per `user_id`, `market_id`, `timeframe`, `close_time`). See [docs/how-we-use-agents.md](../../docs/how-we-use-agents.md).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS` | Same as signal agents | Users for whom decisions are written (trusted env only). |
| `MEDIATOR_AFTER_SIGNALS_DISABLE` | Optional | Set to `1` to skip enqueueing the mediator after the signal pass. |
| `MEDIATOR_RISK_RAILS_JSON` | Optional | JSON object merged over defaults (`maxRiskPerTrade`, `maxOpenPositions`, …, optional `allowAdd`). |
| `MEDIATOR_DEFAULT_NOTIONAL_EUR` | Optional | Suggested EUR size before risk clamp (default `100`). |
| `SIGNALS_CATALOG_CLOSE_*` | Optional | Same batch caps as the signal worker (`MARKET_BATCH_SIZE`, `MAX_TOTAL_MARKETS`, `INLINE_MAX_ITERS`). |

Manual worker call (dev):

```bash
curl -sS -X POST "http://localhost:3000/api/workers/mediator-catalog-close" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -H "Content-Type: application/json" ^
  -d "{\"closeTimeIso\":\"2026-05-09T12:00:00.000Z\"}"
```
