# Agent notes — Trade Agent monorepo

This file orients coding agents and contributors: **routing**, **UI/blocks**, **auth**, **object models**, and **how to add a new table + UI**.

## Localhost-first

Develop and test on **localhost** (`pnpm dev`, repo-root `.env`, local Supabase). Workers: `CRON_SECRET` + manual **Sync now** or `GET`/`POST /api/workers/*` — see [.cursor/rules/localhost-first.mdc](.cursor/rules/localhost-first.mdc).

## App routing (Next.js App Router)

- Authenticated UI lives in the **route group** [`apps/web/src/app/(app)/`](apps/web/src/app/(app)/). Parentheses mean `(app)` does **not** appear in the URL.
- There is **no** `/dashboard` prefix. Legacy `/dashboard` and `/dashboard/*` URLs **redirect** (see [`apps/web/next.config.ts`](apps/web/next.config.ts)).
- **Overview** (post-login default): [`/overview`](apps/web/src/app/(app)/overview/page.tsx).
- **Public** routes (no session required): `/`, `/login`, `/register`, `/api/*`, `/auth/*`. Everything else requires a signed-in user (see [`apps/web/src/lib/supabase/middleware.ts`](apps/web/src/lib/supabase/middleware.ts)).

### Salesforce-style object URLs

| URL pattern | Purpose |
|-------------|---------|
| `/{objectSlug}` | **List** view. Page header should include **New** (dialog/sheet), not only a separate `/new` route unless you intentionally support deep links. |
| `/{objectSlug}/{id}` | **Record detail**. Use **`DetailPageLayout`** from `@repo/blocks` (it wraps `RecordDetailLayout`). Header actions: **Edit** (dialog), **Delete** (confirm). |
| `/{objectSlug}/{id}/{relatedSlug}` | **Related list**: same list chrome as the top-level list, filtered by the parent record `id` on the appropriate FK. Example: [`/executors/[id]/orders`](apps/web/src/app/(app)/executors/[id]/orders/page.tsx). |

**`objectSlug`**: URL-friendly segment (often plural kebab-case: `trade-decisions`, `signal-agents`). It may differ from the Postgres table name; the **model** (below) maps slug → `schema.table`.

**Dynamic segment**: Prefer **`[id]`** for record routes (aligned with Next route folders).

**Exceptions**: User prefs [`/me/preferences`](apps/web/src/app/(app)/me/preferences/page.tsx), internal docs [`/docs`](apps/web/src/app/docs/page.tsx), legacy redirects under [`/settings`](apps/web/src/app/(app)/settings/page.tsx).

## UI / `@repo/blocks`

- **List shell**: [`ListViewLayout`](packages/blocks/src/components/list-view-layout.tsx) — soft page background for list/overview pages; pair with [`ObjectListViewHeader`](apps/web/src/components/object-list-view-header.tsx) (wraps `PageHeader` variant `list`).
- **Detail shell**: [`DetailPageLayout`](packages/blocks/src/components/detail-page-layout.tsx) — full detail chrome; **prefer this** over using `RecordDetailLayout` alone unless you only need the bare background.
- **Tabs**: [`RecordDetailTabs`](apps/web/src/components/record-detail-tabs.tsx) for Details / Related on record pages.
- **Nav / header**: [`AppSchemaNav`](apps/web/src/components/app-schema-nav.tsx), [`AppHeaderActions`](apps/web/src/components/app-header-actions.tsx) in [`(app)/layout.tsx`](apps/web/src/app/(app)/layout.tsx) and [`docs/layout.tsx`](apps/web/src/app/docs/layout.tsx).

Further UI conventions: [docs/dashboard-ui-conventions.md](docs/dashboard-ui-conventions.md) (naming is historical; paths refer to `(app)`).

## Object model per table

For each “business object” (usually aligned with a primary table), maintain a small **exported definition** under [`apps/web/src/models/`](apps/web/src/models/):

- Start from [`types.ts`](apps/web/src/models/types.ts) (`CatalogObjectDef`, `ObjectRelationDef`).
- Examples: [`assets.ts`](apps/web/src/models/assets.ts), [`executors.ts`](apps/web/src/models/executors.ts).

Use these as the checklist source when adding migrations + routes.

## Checklist: new database table → app surface

1. **Migration** (+ RLS/policies) in `supabase/migrations/`.
2. **Model** file in `apps/web/src/models/<slug>.ts` (`slug`, `schema`, `table`, `idColumn`, `label`, `relations`).
3. **Routes** under `(app)/`:
   - `(app)/<slug>/page.tsx` — list.
   - `(app)/<slug>/[id]/page.tsx` — detail with `DetailPageLayout` + edit/delete actions as appropriate.
   - For each FK child list you expose: `(app)/<parentSlug>/[id]/<relatedSlug>/page.tsx` — list with FK filter.
4. **Nav**: add link in [`AppSchemaNav`](apps/web/src/components/app-schema-nav.tsx) when the object should appear in the shell.
5. **Cache**: update `revalidatePath` / `revalidateTag` in server actions for every path segment you render (including nested related URLs).
6. **Tests** (when behavior is non-trivial).

## Imports after refactors

Server actions and colocated components use paths such as `@/app/(app)/<feature>/...` — the `(app)` segment is part of the filesystem path, not the URL.

## Auth defaults

- After login / register / auth callback, `next` defaults to **`/overview`** when not specified ([`login/page.tsx`](apps/web/src/app/login/page.tsx), [`register/page.tsx`](apps/web/src/app/register/page.tsx), [`auth/callback/route.ts`](apps/web/src/app/auth/callback/route.ts)).
