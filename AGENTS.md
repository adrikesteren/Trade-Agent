# Agent notes — Trade Agent monorepo

This file orients coding agents and contributors: **routing**, **UI/blocks**, **auth**, **object models**, and **how to add a new table + UI**.

## AdriCore vs this app

- [`@repo/adricore`](packages/adricore/README.md) is a **framework** package (reusable blocks, metadata OOP classes, generic tab URL helpers). It does **not** contain Trade Agent–specific routes, navigation entries, or object registries.
- **This product** composes AdriCore in **`apps/web`**: each business object is modeled with a **subclass of [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.ts)** (required for **new** objects), plus shell nav in [`apps/web/src/config/app-shell.ts`](apps/web/src/config/app-shell.ts) (`appRegistry` + cookie-driven active `AppMetadata`; see `DEFAULT_APP_ID` / `ACTIVE_APP_COOKIE_NAME` in `@repo/adricore/metadata`). The OOP class structure carries the **standard column contract** (`id`, `name`, `created_by`, `created_at`, `updated_by`, `updated_at`). **`@repo/trading`** is **trading/risk domain** code (`@repo/risk`), not the dashboard shell — do not place app shell or AdriCore wiring there unless it is genuinely trading-domain metadata consumed by that package.

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

## Object model per table

For each “business object” (usually aligned with a primary table), maintain a small **exported definition** under [`apps/web/src/models/`](apps/web/src/models/):

- Start from [`types.ts`](apps/web/src/models/types.ts) (re-exports from [`@repo/adricore/metadata`](packages/adricore/src/metadata/index.ts)). Metadata modules provide OOP base classes for `ObjectMetadata`, `ObjectFieldMetadata`, `ObjectRelationshipMetadata`, and Registries.
- **New objects:** Add a **class extending [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.ts)**. The base class documents the DB contract: `id`, `name`, `created_by`, `created_at`, `updated_by`, `updated_at`. Wire the registry and UI as needed.
- Examples: [`assets.ts`](apps/web/src/models/assets.ts), [`executors.ts`](apps/web/src/models/executors.ts), [`logs.ts`](apps/web/src/models/logs.ts).

Use these as the checklist source when adding migrations + routes. AdriCore authoring: [`packages/adricore/docs/new-table.md`](packages/adricore/docs/new-table.md), list/detail UI: [`packages/adricore/docs/ui-list-detail.md`](packages/adricore/docs/ui-list-detail.md), package overview: [`packages/adricore/README.md`](packages/adricore/README.md).

**`nameField` on `ObjectMetadata`:** use `{ mode: "manual" }` when the row `name` is user-editable; use `{ mode: "autoNumber", displayFormat: "…{0000}", startNumber?: n }` when `name` is system-generated (DB sequence / counter + UI read-only still to be wired per object).

## Checklist: new database table → app surface

1. **Migration** (+ RLS/policies) in `supabase/migrations/`.
2. **Model** in `apps/web/src/models/<slug>.ts`: a **subclass of [`ObjectMetadata`](packages/adricore/src/metadata/object-metadata.ts)**. The migration for the table must include the **standard columns** (`id`, `name`, `created_by`, `created_at`, `updated_by`, `updated_at`).
3. **Routes** under `(app)/`:
   - `(app)/<slug>/page.tsx` — list.
   - `(app)/<slug>/[id]/page.tsx` — detail with `DetailPageLayout` + edit/delete actions as appropriate.
   - For each FK child list you expose: `(app)/<parentSlug>/[id]/<relatedSlug>/page.tsx` — list with FK filter.
4. **Nav**: when you add a top-level list, add a tab to the appropriate entry in **`appRegistry`** in [`apps/web/src/config/app-shell.ts`](apps/web/src/config/app-shell.ts) (usually `appRegistry[DEFAULT_APP_ID]`; uses `AppMetadata` / `TabMetadata` from AdriCore).
5. **Cache**: update `revalidatePath` / `revalidateTag` in server actions for every path segment you render (including nested related URLs).
6. **Tests** (when behavior is non-trivial).

## Imports after refactors

Server actions and colocated components use paths such as `@/app/(app)/<feature>/...` — the `(app)` segment is part of the filesystem path, not the URL.

## Auth defaults

- After login / register / auth callback, `next` defaults to **`/overview`** when not specified ([`login/page.tsx`](apps/web/src/app/login/page.tsx), [`register/page.tsx`](apps/web/src/app/register/page.tsx), [`auth/callback/route.ts`](apps/web/src/app/auth/callback/route.ts)).
