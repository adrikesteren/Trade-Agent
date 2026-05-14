# Agent notes — Trade Agent monorepo

This file orients coding agents and contributors: **routing**, **UI/blocks**, **auth**, **object models**, and **how to add a new table + UI**.

## AdriCore vs this app

- [`@repo/adricore`](packages/adricore/README.md) is a **framework** package (reusable blocks, metadata OOP classes, generic tab URL helpers). It does **not** contain Trade Agent–specific routes, navigation entries, or object registries.
- **This product** composes AdriCore in **`apps/web`**: each business object is modeled with a **subclass of [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.tsx)** or, for high-volume / append-only tables, [`HighVolumeObjectMetadata`](packages/adricore/src/metadata/high-volume-object-metadata.tsx). Both extend the shared [`ObjectMetadataBase`](packages/adricore/src/metadata/object-metadata-base.tsx). Shell nav lives in [`apps/web/src/config/app-shell.ts`](apps/web/src/config/app-shell.ts) (`appRegistry` + cookie-driven active `AppMetadata`; see `DEFAULT_APP_ID` / `ACTIVE_APP_COOKIE_NAME` in `@repo/adricore/metadata`). The OOP class structure carries the **standard column contract**:
  - `ObjectMetadataBase` (the base) → `id`, `created_by`, `created_at`, `updated_by`, `updated_at` (registry: `baseObjectFieldRegistry`).
  - `ObjectMetadata` → adds a user-facing `name` column + `nameField: NameFieldSpec` (registry: `standardObjectFieldRegistry`).
  - `HighVolumeObjectMetadata` → no `name`, no `nameField`. `getRecordTitle` falls back to id.
- **`@repo/trading`** is **trading/risk domain** code (`@repo/risk`), not the dashboard shell — do not place app shell or AdriCore wiring there unless it is genuinely trading-domain metadata consumed by that package.

## Localhost-first

Develop and test on **localhost** (`pnpm dev`, repo-root `.env`, local Supabase). Workers: `CRON_SECRET` + manual **Sync now** or `GET`/`POST /api/workers/*` — see [.cursor/rules/localhost-first.mdc](.cursor/rules/localhost-first.mdc).

**Agents:** never run `supabase db reset` (or equivalent full DB wipe) unless the maintainer **explicitly** asked for that. Use migration-only commands when applying schema changes. Same rule is spelled out in `localhost-first.mdc`.

## App routing (Next.js App Router)

- Authenticated UI lives in the **route group** [`apps/web/src/app/(app)/`](apps/web/src/app/(app)/). Parentheses mean `(app)` does **not** appear in the URL.
- There is **no** `/dashboard` prefix. Legacy `/dashboard` and `/dashboard/*` URLs **redirect** (see [`apps/web/next.config.ts`](apps/web/next.config.ts)).
- **Overview** (post-login default): [`/overview`](apps/web/src/app/(app)/overview/page.tsx).
- **Public** routes (no session required): `/`, `/login`, `/register`, `/api/*`, `/auth/*`. Everything else requires a signed-in user (see [`apps/web/src/lib/supabase/middleware.ts`](apps/web/src/lib/supabase/middleware.ts)).

### Salesforce-style object URLs

| URL pattern | Purpose |
|-------------|---------|
| `/{objectSlug}` | **List** view. Page header should include **New** (dialog/sheet), not only a separate `/new` route unless you intentionally support deep links. |
| `/{objectSlug}/{id}` | **Record detail**. Use **`DetailPageLayout`** from `@repo/adricore/blocks` (it wraps `RecordDetailLayout`). Header actions: **Edit** (dialog), **Delete** (confirm). |
| `/{objectSlug}/{id}/{relatedSlug}` | **Related list**: same list chrome as the top-level list, filtered by the parent record `id` on the appropriate FK. Example: [`/executors/[id]/orders`](apps/web/src/app/(app)/executors/[id]/orders/page.tsx). |

**`objectSlug`**: URL-friendly segment (often plural kebab-case: `trade-decisions`, `signal-agents`). It may differ from the Postgres table name; the **model** (below) maps slug → `schema.table`.

**Dynamic segment**: Prefer **`[id]`** for record routes (aligned with Next route folders).

**Exceptions**: User prefs [`/me/preferences`](apps/web/src/app/(app)/me/preferences/page.tsx), internal docs [`/docs`](apps/web/src/app/docs/page.tsx), legacy redirects under [`/settings`](apps/web/src/app/(app)/settings/page.tsx).

## UI / `@repo/adricore/blocks`

- **List shell**: [`ListViewLayout`](packages/adricore/src/blocks/components/list-view-layout.tsx) — soft page background for list/overview pages; pair with [`ObjectListViewHeader`](apps/web/src/components/object-list-view-header.tsx) (wraps `PageHeader` variant `list`).
- **Detail shell**: [`DetailPageLayout`](packages/adricore/src/blocks/components/detail-page-layout.tsx) — full detail chrome; **prefer this** over using `RecordDetailLayout` alone unless you only need the bare background.
- **Tabs**: [`RecordDetailTabs`](apps/web/src/components/record-detail-tabs.tsx) for Details / Related on record pages.
- **Nav / header**: [`AppSchemaNav`](apps/web/src/components/app-schema-nav.tsx), [`AppHeaderActions`](apps/web/src/components/app-header-actions.tsx) in [`(app)/layout.tsx`](apps/web/src/app/(app)/layout.tsx) and [`docs/layout.tsx`](apps/web/src/app/docs/layout.tsx).

Further UI conventions: [docs/dashboard-ui-conventions.md](docs/dashboard-ui-conventions.md) (naming is historical; paths refer to `(app)`).

## Object folder layout

For each "business object" (usually aligned with a primary table), maintain a small **exported definition** under either folder:

- [`apps/web/src/lib/objects/<object>/`](apps/web/src/lib/objects/) for **regular** objects (subclass of `ObjectMetadata`, with a user-facing `name` column).
- [`apps/web/src/lib/high-volume-objects/<object>/`](apps/web/src/lib/high-volume-objects/) for **high-volume / append-only** tables modeled as `HighVolumeObjectMetadata` (logs, candles, candle_timestamps, signals, signal_jobs, signal_runs, schedule_runs, sync_runs, wallet_transactions, fills, executor_moving_floors, executor_historical_runs). These tables omit `name` on purpose — the storage overhead of a text column on tables that grow to millions of rows is not worth the marginal UX win.

Conventions:

- One folder per object; the metadata class file uses the suffix **`.object.ts`** (kebab-case) — for example [`assets/assets.object.ts`](apps/web/src/lib/objects/assets/assets.object.ts), [`executors/executors.object.ts`](apps/web/src/lib/objects/executors/executors.object.ts), [`high-volume-objects/logs/logs.object.ts`](apps/web/src/lib/high-volume-objects/logs/logs.object.ts).
- Cross-cutting object files live at the root of `lib/objects/`: [`registry.ts`](apps/web/src/lib/objects/registry.ts) (central `objectRegistry`, also registers the high-volume objects) and [`icons.ts`](apps/web/src/lib/objects/icons.ts) (icon registry).
- Per-object services (when they exist) belong in `lib/objects/<object>/services/<name>.service.ts` — **not** in `lib/agents/`. Create the `services/` subfolder only when the first service is added.
- **New objects:** add a class extending [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.tsx) (user-facing rows) or [`HighVolumeObjectMetadata`](packages/adricore/src/metadata/high-volume-object-metadata.tsx) (append-only / millions of rows). Import metadata types directly from [`@repo/adricore/metadata`](packages/adricore/src/metadata/index.ts) (provides OOP base classes for `ObjectMetadataBase`, `ObjectMetadata`, `HighVolumeObjectMetadata`, `ObjectFieldMetadata`, `ObjectRelationshipMetadata`, and Registries). Wire the new class into `lib/objects/registry.ts` and the UI as needed.

Use these as the checklist source when adding migrations + routes. AdriCore authoring: [`packages/adricore/docs/new-table.md`](packages/adricore/docs/new-table.md), list/detail UI: [`packages/adricore/docs/ui-list-detail.md`](packages/adricore/docs/ui-list-detail.md), package overview: [`packages/adricore/README.md`](packages/adricore/README.md).

**`nameField` on `ObjectMetadata`** (regular only; `HighVolumeObjectMetadata` has no `name` column and ignores this concept):

- `{ mode: "manual" }` — user supplies the name (e.g. assets, exchanges, tasks, executors, signal_agents).
- `{ mode: "autoNumber", displayFormat: "PREFIX-{0000}", startNumber?: n }` — name is system-generated. A per-table Postgres sequence + BEFORE INSERT trigger fills the column on write. The Salesforce-style placeholder is `{0000}` for zero-padded numbers; the leading text is the prefix (e.g. `ORD-`, `DEC-`, `WAL-`).
- `{ mode: "formula", description, compute? }` — name is derived from other columns / joined rows by a Postgres trigger (e.g. markets: `base.code-quote.code`). The optional `compute` function is a UI fallback for when the joined row is not present on the client; the DB trigger is authoritative.

**Changing an auto-name format**: write a **new migration** that `create or replace function`s the per-table auto-name trigger function with the new prefix/padding. Existing rows are NOT backfilled — they keep their old names. Only new rows pick up the new format.

**Automation user RLS pattern**: rows authored by the `automated-process@system.invalid` user (resolved via [`public.is_catalog_automated_process_user(uuid)`](supabase/migrations/20260630120000_trading_automated_process_visibility_fallback.sql)) must be visible to every authenticated user, and the automation user — when signed in — must be able to read every row. For SELECT-only widening, gate the policy on the schema-agnostic helper [`public.row_owner_visible(user_id)`](supabase/migrations/20260722190000_rls_row_owner_visible_helper.sql) (own row OR automation-owned OR caller is automation). INSERT/UPDATE/DELETE stay strict via the trading-specific [`public.trading_row_accessible(user_id)`](supabase/migrations/20260628130200_trading_automated_full_dml_all_rows.sql) helper.

## Wallets and quote-asset budgets

Trading framework v2 (P1) reorganises **how money is allocated to executors** so the same exchange account can host multiple executors and so each executor can have **per-quote-asset budgets** (e.g. spend up to €500 in EUR markets, $250 in USDT markets) instead of a single EUR number that hides FX assumptions.

### Wallet model — one shared wallet per (user, exchange) for live/paper, isolated per executor for historical

- `trading.wallets` rows now carry an explicit **`kind` enum** (`shared_exchange` | `historical_paper`) plus an **`exchange_id`** FK (see [`20260723100100_wallets_shared_per_exchange.sql`](supabase/migrations/20260723100100_wallets_shared_per_exchange.sql)).
- For **`paper` and `live`** executors, the `executors_create_wallet` trigger first looks for an existing `shared_exchange` wallet for `(user_id, exchange_id)` and assigns that id to `executors.wallet_id`. Only when none exists does it create one. Result: every executor on Bitvavo for the same user shares a single wallet — deposits, withdrawals, buys, and sells all touch one balance per asset.
- For **`historical`** executors, the trigger always creates a fresh `historical_paper` wallet so backtests can be funded and reset without affecting the user's live/paper books.
- Partial unique indexes enforce the rule at the database layer: at most one `shared_exchange` wallet per `(user_id, exchange_id)`, and one `historical_paper` wallet per executor.

### `apply_wallet_*` RPCs follow `executors.wallet_id`

The deposit / withdrawal / trade RPCs (`apply_wallet_balance_change`, `apply_wallet_trade_buy_debit`, `apply_wallet_trade_sell_credit`) used to look the wallet up via `wallets.executor_id`. They now resolve the wallet id directly from `trading.executors.wallet_id` (see [`20260723100200_wallet_rpcs_follow_executor_wallet_id.sql`](supabase/migrations/20260723100200_wallet_rpcs_follow_executor_wallet_id.sql)). Signatures are unchanged. The same idea is mirrored in app code by [`resolveExecutorWalletId`](apps/web/src/lib/objects/executors/services/executor-wallet-resolve.service.ts).

### Quote-asset budgets — `trading.executor_quote_asset_budget`

The legacy column `executors.default_notional_eur` was a single EUR number applied regardless of which quote asset the market actually trades in (EUR, USDT, BTC, …). It has been **replaced** by a junction table:

- [`trading.executor_quote_asset_budget`](supabase/migrations/20260723100000_executor_quote_asset_budget.sql) — one row per `(executor, quote_asset)` pair, storing `max_notional_primary` in the user's **primary fiat** (e.g. EUR for European users, USD for US users — driven by `me/preferences`).
- The mediator converts that primary amount into **quote units** at decision time using `asset.dollar_value` triangulation (see [`primaryUnitsToQuoteUnits`](apps/web/src/lib/catalog/primary-to-quote.ts)). The service that wraps the lookup + conversion is [`fetchExecutorQuoteBudgetInQuoteUnits`](apps/web/src/lib/agents/executor/services/executor-quote-budget.service.ts).
- A market whose quote asset has **no row** in the junction is **skipped** by the mediator with `reason_codes=["quote_asset_not_allowed"]` (see [`buildQuoteAssetNotAllowedSkipDecision`](apps/web/src/lib/agents/trade-mediator/services/catalog-close-mediator-run.service.ts)). This is the explicit way to disable certain quote books for an executor.
- The deprecated `default_notional_eur` column was dropped in [`20260723100300_drop_executors_default_notional_eur.sql`](supabase/migrations/20260723100300_drop_executors_default_notional_eur.sql).

UI: the executor create / edit form replaces the single "Default order size (EUR)" input with a dynamic **list editor** of `(quote asset, max notional in primary fiat)` rows. The list of quote-asset options per exchange is computed from `catalog.markets` by [`fetchQuoteAssetOptionsByExchange`](apps/web/src/app/(app)/executors/quote-asset-options.ts) so users can only pick quotes that actually exist on that exchange.

### Run button — historical replay enable rule

The "Run" button on the executor detail page is enabled only when the executor's **paper market quote-asset balance** is positive (e.g. EUR for `GIGA-EUR`), not the base — that is the asset the historical replay actually spends on entries. See [`ExecutorHistoricalRunHeaderAction`](apps/web/src/app/(app)/executors/[id]/executor-historical-run-header-action.tsx) and the `historicalQuoteWalletBalance` lookup in [`(app)/executors/[id]/page.tsx`](apps/web/src/app/(app)/executors/[id]/page.tsx).

## Exchange capabilities & position sides framework

Trading framework v2 (P2) introduces **per-exchange capability flags** plus a typed **`position_side`** dimension on positions, orders, and decisions. This is the foundation for spot-vs-margin / long-vs-short routing — even though P2 only physically executes long entries (Bitvavo is spot-only). The mediator and executor are now side-aware end-to-end, and short execution is a typed stub that fails loud rather than silently going long.

### Exchange capability flags — `catalog.exchanges`

`catalog.exchanges` carries four boolean capability columns (see [`20260723110000_exchange_capabilities.sql`](supabase/migrations/20260723110000_exchange_capabilities.sql)):

- `supports_spot_buy` — exchange supports buying base on the spot book (Bitvavo: **true**).
- `supports_spot_sell` — exchange supports selling base on the spot book (Bitvavo: **true**).
- `supports_margin_long` — exchange supports leveraged long positions (Bitvavo: **false**).
- `supports_margin_short` — exchange supports short positions (Bitvavo: **false**).

These are exposed on the `ExchangesModel` ObjectMetadata so they show up on the exchange list/detail pages out of the box. The seed migration explicitly stamps Bitvavo as **spot-only** so existing data picks up the right defaults. An app-level helper, [`fetchExchangeCapabilitiesById`](apps/web/src/app/(app)/executors/exchange-capabilities.ts), gives the executor form / actions a single batched lookup of the per-exchange capabilities.

### `position_side` enum + `executor.allowed_sides`

A new Postgres enum `trading.position_side` has values `long | short`. It is added as a typed column on `trading.positions`, `trading.orders`, and `trading.decisions` so nothing has to parse JSON to know what side a row represents (see [`20260723110100_position_side_enum_and_allowed_sides.sql`](supabase/migrations/20260723110100_position_side_enum_and_allowed_sides.sql)).

`trading.executors.allowed_sides` is a non-empty `position_side[]` array describing which sides this executor is configured to trade. Existing executors are seeded to `['long']`. The app reads this through the helper [`executorAllowedSides`](apps/web/src/lib/agents/executor/services/executors-lookup.service.ts) which always returns a normalised array (defaulting to `['long']` for legacy rows).

### Positions uniqueness — long + short can coexist

The unique key on `trading.positions` was widened from `(user, executor, market)` to `(user, executor, market, position_side)`. This makes it possible to hold **both** a long and a short position on the same market under the same executor — a prerequisite for the Stop-and-Reverse (SAR) flow planned in P3. There is also a covering index for fast lookup of open positions by `(executor, side)`.

### UI — sides editor on the executor form

The executor create / edit form ([`executor-form.tsx`](apps/web/src/app/(app)/executors/executor-form.tsx)) renders an **"Allowed position sides"** block with `Long` / `Short` checkboxes. The checkboxes are **filtered by the selected exchange's capabilities**: a side is only offered if the exchange supports either the spot or margin variant for that direction (`long` ⇢ `supports_spot_buy || supports_margin_long`; `short` ⇢ `supports_margin_short`). When the user switches exchange, the form re-evaluates and removes any selection that the new exchange cannot support. The server actions ([`(app)/executors/actions.ts`](apps/web/src/app/(app)/executors/actions.ts)) re-validate this with `assertSidesAllowedByExchange` so a malicious / stale form post cannot bypass the capability check.

### Mediator — side-aware decisions

The catalog-close mediator ([`catalog-close-mediator-run.service.ts`](apps/web/src/lib/agents/trade-mediator/services/catalog-close-mediator-run.service.ts)) now:

- Skips an executor when `executorAllowedSides(ex)` does **not** include `long` (the only side the deterministic mediator currently proposes). The skip writes `reason_codes=["side_not_allowed"]`-style decision with `position_side: 'long'` so the row is still auditable.
- Stamps the proposed `position_side` on both the `trading.decisions.position_side` column and inside `decision_payload.proposedOrder.positionSide` so the executor can read it without re-deriving intent.

### Executor — side gating + short stub

The catalog-close executor ([`catalog-close-executor-run.service.ts`](apps/web/src/lib/agents/executor/services/catalog-close-executor-run.service.ts)) reads the side via [`parseProposedPositionSide`](apps/web/src/lib/agents/executor/services/catalog-close-executor-run.service.ts) (looks at `proposedOrder.positionSide` first, falls back to top-level `positionSide`, then defaults to `long` for legacy decisions). It then enforces two rules:

1. If the decision side is **not** in the executor's `allowed_sides`, insert a `rejected` order with reason `position_side_not_allowed` and log it. No wallet movement.
2. If the decision side is `short`, insert a `rejected` order with reason `short_execution_not_implemented`. P2 is framework-only for shorts; physical short execution lands in P3 / the venue-specific margin client.

Long entries continue to flow through the existing paper-fill path unchanged.

### UI display — `PositionSidePill`

A small reusable component [`PositionSidePill`](apps/web/src/components/position-side-pill.tsx) renders `Long` (emerald) / `Short` (amber) pills. It is wired into the orders list & detail, the trade-decisions list & detail, and is available for any future surface that needs to surface the side at a glance.

### Bitvavo — practical impact

Because Bitvavo is seeded as `supports_spot_buy=true, supports_spot_sell=true, supports_margin_long=false, supports_margin_short=false`:

- New executors on Bitvavo can only check the **Long** side. The form hides the Short option entirely.
- Any historical / paper run that somehow yields a short decision (e.g. imported from another exchange) is rejected at the executor with `short_execution_not_implemented`, not silently flipped to a long buy.

## Phase 3 — smarter deterministic signals & SAR

P3 builds on P1 budgets + P2 sides to layer **regime-aware gating**, **multi-timeframe confluence**, **explicit EXIT signals**, **volatility / volume / ADX filters**, and **automated Stop-and-Reverse** on top of the existing pipeline. All P3 work stays deterministic — no LLM calls — so historical replays remain reproducible. Full developer guide: [docs/signal-agents-developer.md → Phase 3](docs/signal-agents-developer.md#phase-3-p3-signal-stack--regime-volatility-multi-timeframe-sar) and [docs/mediator-developer.md → Phase 3](docs/mediator-developer.md#phase-3-p3--regime-gating-position-sides--sar).

### New signal agents (P3)

- `regime-classifier-15m-v1` — daily-200 trend + slope; emits `HOLD` with `metadata.regime ∈ {bull, bear, sideways}`. Read by the mediator (regime gating) and SAR.
- `multi-tf-confluence-15m-v1` — 4h trend (SMA) + 15m RSI entry trigger; emits `ENTER` long when both align.
- `ma-cross-15m-v1`, `rsi-reversion-5m-v1`, `breakout-atr-5m-v1` — extended to emit explicit `EXIT` intents on cross-down / overbought-cross-down / breakout-failure.

Seed: [`supabase/migrations/20260723110400_seed_p3_signal_agents.sql`](supabase/migrations/20260723110400_seed_p3_signal_agents.sql).

### Cross-cutting filters (configurable per agent via `config` JSON)

- **Volatility gate** (`minAtrPct`, `maxAtrPct`, optional `atrPeriod`) on all ENTER paths. Helper: `apps/web/src/lib/markets/atr-volatility-gate.ts`.
- **ADX trend filter** — `rsi-reversion-*` skips ENTER when ADX > `maxAdx`; `breakout-atr-*` skips ENTER when ADX < `minAdx`. Helper: `apps/web/src/lib/markets/adx.ts`.
- **Volume confirmation** on `breakout-atr-*` — requires bar volume ≥ `avg(volumeLookbackBars) × volumeConfirmationMultiplier`.

### Mediator regime gating

`trading.executors.mediator_rails_extra.regimeGatingEnabled = true` enables the mediator to demote `ENTER` intents from other agents when the regime classifier reports `bear` or `sideways`. `multi-tf-confluence-15m-v1` ENTER overrides the sideways gate. EXIT intents are always preserved. Helper: `apps/web/src/lib/agents/trade-mediator/services/regime-gating.service.ts`.

### `signal_side` on `trading.signals`

P3 adds a `signal_side ∈ {long, short}` column to `trading.signals` (default `long`) so the mediator + SAR know which side an ENTER signal would take. Migration: [`supabase/migrations/20260723110200_signals_signal_side.sql`](supabase/migrations/20260723110200_signals_signal_side.sql).

### Stop-and-Reverse (SAR)

When the regime classifier confirms a flip (`bull→bear→bear` or `bear→bull→bull` over the last three regime classifier signals for the same `(user, market)`), the mediator writes **paired** decisions on the regime classifier `signal_id`:

- `EXIT` on the currently open side (only when a position exists).
- `ENTER` on the opposite side (only when in `executor.allowed_sides`).

The unique constraint on `trading.decisions` was widened to `(user_id, executor_id, signal_id, position_side)` so the pair can coexist — see [`supabase/migrations/20260723110300_decisions_uniqueness_with_position_side.sql`](supabase/migrations/20260723110300_decisions_uniqueness_with_position_side.sql).

The executor processes decisions in **EXIT-before-ENTER** order per `(executor, market, bar)` (`exitFirstRank` in `catalog-close-executor-run.service.ts`) so the EXIT credits the wallet before the ENTER tries to debit. On Bitvavo (long-only) SAR reduces in practice to **EXIT-long on a bull→bear flip**.

### Paper-validation checklist

Before promoting any P3 config to a `live` executor, validate end-to-end on a paper executor: see the [paper-validation checklist in signal-agents-developer.md](docs/signal-agents-developer.md#paper-validation-checklist).

## Service folders & naming

Domain/business logic ("services") is organized fflib-style under [`apps/web/src/lib/`](apps/web/src/lib/):

- **Single-namespace services** → `lib/agents/<namespace>/services/<name>.service.ts`. Allowed namespaces: `ingest`, `signal`, `trade-mediator`, `executor` (one per agent).
- **Cross-namespace orchestrators** (services that combine ≥ 2 agents) → `lib/orchestrators/<name>.service.ts`. No namespace folder.
- **Per-object services** → `lib/objects/<object>/services/<name>.service.ts` (only create the subfolder when the first service is added).
- All service files use the suffix **`.service.ts`** (kebab-case) and export plain async functions (`export async function runFoo(...)`). No class/namespace wrappers; tests live next to their source as `<name>.service.test.ts`.

What is **not** a service (do not place under `agents/` or `orchestrators/`, do not rename with `.service.ts`):

- Pure utilities, types, and small helpers (e.g. `lib/automation-actor.ts`, `lib/format-usd-metric.ts`, `lib/trading/close-time-match.ts`).
- Integration clients / SDK wrappers (e.g. raw Bitvavo HTTP under `lib/bitvavo/`).
- UI / chart helpers (e.g. `lib/markets/chart-types.ts`, `aggregate-ohlcv.ts`).
- Infra and cross-cutting concerns: `lib/supabase/`, `lib/env/`, `lib/workers/`, `lib/relay/`, `lib/logs/`, `lib/locale/`, `lib/auth/`, `lib/dashboard/`, `lib/docs/`, `lib/ops/`, `lib/system-settings/`, `lib/tasks/`, `lib/catalog/`.

The same convention is enforced by the always-applied rule [`.cursor/rules/service-folders.mdc`](.cursor/rules/service-folders.mdc). When in doubt about classification, ask first.

## Checklist: new database table → app surface

1. **Migration** (+ RLS/policies) in `supabase/migrations/`.
2. **Model** in `apps/web/src/lib/objects/<slug>/<slug>.object.ts` (regular) or `apps/web/src/lib/high-volume-objects/<slug>/<slug>.object.ts` (append-only). Subclass [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.tsx) or [`HighVolumeObjectMetadata`](packages/adricore/src/metadata/high-volume-object-metadata.tsx) respectively. Register it in [`apps/web/src/lib/objects/registry.ts`](apps/web/src/lib/objects/registry.ts). The migration must include the audit columns from `ObjectMetadataBase` (`id`, `created_by`, `created_at`, `updated_by`, `updated_at`); regular objects additionally need a `name` column populated per the chosen `nameField` mode (see "Object folder layout"). Reuse the helpers from [`20260722000000_object_naming_helpers.sql`](supabase/migrations/20260722000000_object_naming_helpers.sql) (`public.set_updated_at_now()`, `public.format_auto_name(prefix, padding, n)`) when wiring the per-table sequence + triggers.
3. **Routes** under `(app)/`:
   - `(app)/<slug>/page.tsx` — list.
   - `(app)/<slug>/[id]/page.tsx` — detail with `DetailPageLayout` + edit/delete actions as appropriate.
   - For each FK child list you expose: `(app)/<parentSlug>/[id]/<relatedSlug>/page.tsx` — list with FK filter.
4. **Nav**: when you add a top-level list, add a tab to the appropriate entry in **`appRegistry`** in [`apps/web/src/config/app-shell.ts`](apps/web/src/config/app-shell.ts) (usually `appRegistry[DEFAULT_APP_ID]`; uses `AppMetadata` / `TabMetadata` from AdriCore).
5. **Services** (if needed): single-agent business logic → `apps/web/src/lib/agents/<namespace>/services/<name>.service.ts`; cross-agent orchestrators → `apps/web/src/lib/orchestrators/<name>.service.ts`; per-object services → `apps/web/src/lib/objects/<slug>/services/<name>.service.ts`. See "Service folders & naming" above.
6. **Cache**: update `revalidatePath` / `revalidateTag` in server actions for every path segment you render (including nested related URLs).
7. **Tests** (when behavior is non-trivial).

## Imports after refactors

Server actions and colocated components use paths such as `@/app/(app)/<feature>/...` — the `(app)` segment is part of the filesystem path, not the URL.

## Auth defaults

- After login / register / auth callback, `next` defaults to **`/overview`** when not specified ([`login/page.tsx`](apps/web/src/app/login/page.tsx), [`register/page.tsx`](apps/web/src/app/register/page.tsx), [`auth/callback/route.ts`](apps/web/src/app/auth/callback/route.ts)).
