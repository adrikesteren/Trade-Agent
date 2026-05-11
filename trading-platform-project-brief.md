# Project context — paste this in a new chat

Use this document as **single source of truth** for what we are building. The assistant should treat this as requirements + architecture intent, not as financial advice.

---

## One-liner

Build a **trading automation platform** (starting with **paper trading**) where **signal agents** propose actions and a **Trade Mediator** enforces risk rules and executes (paper first, then live at small size). Primary market focus: **Netherlands / EUR**, first exchange connector: **Bitvavo**. Long-term: **multi-exchange** and optional **wallet/DEX** connectors behind the same abstractions.

---

## Non-goals / disclaimers

- No guarantee of profit; this is **risk tooling + automation**, not investment advice.
- Live trading only after **paper trading**, metrics, and hard **risk rails** are in place.
- Secrets (API keys) must never be committed; use environment / secret managers.

---

## Product pillars

1. **Separation of concerns**
  - **Signal agents**: read market data, output `BUY | SELL | HOLD` + confidence + structured reasons + invalidation rules. **No direct order placement.**
  - **Trade Mediator**: single authority that approves/denies execution based on mode, risk state, portfolio state, and connector capabilities.
  - **Execution connectors**: Bitvavo first; later additional exchanges; optional wallet/DEX later.
2. **Operational modes (budget / risk posture)**
  - **Paper**: simulated orders and PnL; full logging; validate strategies.
  - **Micro**: real orders at **minimum viable size** + tight daily loss limits.
  - **BigSpender**: only after objective go/no-go criteria; still bounded by max drawdown / kill switches.
3. **Event model (candle-close first)**
  - Prefer decisions on **closed candles** (indicators stable), not every tick.
  - Internal event: `CANDLE_CLOSED(exchange, symbol, timeframe, closeTime)`.
  - Implementation can be **websocket** (detect `isClosed`) + **polling fallback** + scheduled **worker HTTP** calls for heartbeat/reconciliation.
4. **Background execution**
  - Trading loop runs in **headless workers** (containers/VPS/cron + queue), **not** dependent on a browser tab.
  - Next.js is for **dashboard, config, audit UI**; workers do ingestion, signals, mediation, execution.
5. **Multi-platform future**
  - Design **exchange-agnostic** interfaces early (`ExchangeAdapter`, normalized symbols/orders, capability flags per venue).
  - Wallet/DEX path is **higher risk** (approvals, MEV, gas); separate policy + allowlists.

---

## Intended stack


| Layer                       | Choice             | Role                                                                                        |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| Web app                     | **Next.js**        | Marketing, dashboard, settings, logs, manual controls                                       |
| Mobile (optional phase)     | **Expo**           | Companion app: alerts, approvals, read-only portfolio                                       |
| Database / auth / realtime  | **Supabase**       | Postgres schema, RLS where appropriate, auth if needed, optional realtime for UI            |
| Cache / rate limits / locks | *(none in v1)*     | Idempotency via DB uniqueness; add Redis or similar later if needed                      |
| Jobs / schedules / webhooks | **HTTP workers + host cron** | Same-process or OS-scheduled `GET`/`POST /api/workers/*` with `CRON_SECRET` (candle jobs, reconciliation, nightly rollups) |


---

## Data model (minimum viable tables — Postgres / Supabase)

Conceptual entities (names can vary):

- `candles` — OHLCV + `close_time` + unique key per `(exchange, symbol, timeframe, close_time)`
- `signals` — agent id, action, confidence, reasons JSON, linked candle
- `trade_decisions` — mediator output: approved/denied, reason codes, snapshot of risk state
- `orders` / `fills` / `positions` — paper vs live, external ids, status machine
- `risk_state` — daily PnL, drawdown, streaks, kill switch flags
- `connectors` / `accounts` — which exchange keys, mode, allowlisted symbols

**Idempotency:** enforce uniqueness so the same closed candle cannot produce duplicate decisions/orders.

---

## Worker topology (suggested)

1. **Ingest worker** — fetch or stream candles; persist; emit `CANDLE_CLOSED`.
2. **Signal worker(s)** — compute indicators / LLM-assisted research optional later; write `signals`.
3. **Mediator worker** — read latest signals + risk; write `trade_decisions`.
4. **Executor worker** — place paper or live orders via Bitvavo adapter; update `orders`/`fills`.
5. **Reconciliation job** — periodic sync with exchange truth (scheduled worker).

Use **your scheduler** for: periodic worker ticks; workers run inline in Next unless you wrap them externally. Add external locks or queues only if you outgrow single-host cron + DB idempotency.

---

## Risk rails (must be enforceable in code)

- Max risk per trade (% of equity or fixed EUR).
- Max open positions / max exposure per symbol.
- Daily loss limit → **kill switch** (stop new entries; optionally flatten per policy).
- Max drawdown limit.
- Cooldown after N losses.
- Circuit breakers: API errors, stale data, abnormal spread/volatility (policy-defined).
- API keys: trade-only permissions where possible; no withdrawal permissions for trading keys.

---

## Naming / branding (working)

Wordplay direction: **stock + trade + agent** → e.g. `stocktragent.com` (verify registrar). Domain is secondary to architecture.

---

## Implementation order (phased)

1. Supabase schema + RLS patterns + audit logging conventions.
2. Bitvavo **read-only** + candle ingest + closed-candle pipeline (paper).
3. Mediator + risk engine + paper executor + dashboard for decisions.
4. Live **Micro** on Bitvavo with hard caps + reconciliation + alerts.
5. Second exchange adapter (proves multi-venue design).
6. Expo app: notifications + read-only v1; approvals later if desired.

---

## What to optimize for in code reviews

- **Correctness** over cleverness (especially order state + idempotency).
- **Observable** systems: structured logs, trace ids, decision reasons persisted.
- **Safe defaults**: if uncertain, **do not trade**.

---

## Open questions for the user (resolve when starting build)

- Exact **timeframes** (e.g. 5m / 15m / 1h) and **symbol universe** (EUR pairs).
- Whether v1 is **alerts-only** or **auto-execute** in paper/live.
- Hosting target for workers (Fly.io, Railway, VPS, etc.).
- Whether mobile (Expo) is **phase 1** or **phase 2**.

---

## How assistants should work in this repo

- Prefer **small PR-sized changes** with clear rationale.
- Do not expand scope into unrelated refactors.
- When touching trading execution, always include **tests or dry-run paths** for paper mode.

---

*End of paste-friendly brief.*