# @repo/adricore

**Framework-package** (herbruikbaar buiten dit monorepo): UI-primitieven (`blocks`), declarative metadata OOP classes (`metadata`), en kleine platform-hulpjes (`platform`) zoals tab-URL-helpers.

## Wat hier níet hoort

- Geen **app-specifieke** routes, navigatie-inhoud, of objectregisters.
- Geen kennis van “Trade Agent”, Supabase-tabellen van dit product, of `apps/web`.

Die dingen configureer je in **jouw applicatie** (in deze repo: vooral [`apps/web`](../../apps/web)), bijvoorbeeld:

- actieve app / tabs: `Record<string, AppMetadata>` in [`apps/web/src/config/app-shell.ts`](../../apps/web/src/config/app-shell.ts); default key en cookienaam staan in [`app-metadata.ts`](./src/metadata/app-metadata.ts) (`DEFAULT_APP_ID`, `ACTIVE_APP_COOKIE_NAME`).
- concrete `ObjectMetadata`-objecten en registry: [`apps/web/src/models/`](../../apps/web/src/models), [`apps/web/src/lib/schema/`](../../apps/web/src/lib/schema).

`@repo/trading` is **geen** shell-laag: dat is **domein-/risk-logica** voor trading (`package.json` → `@repo/risk`). Gebruik **`apps/web`** (of een toekomstige app-package) voor AdriCore-wiring.

## Subpaths

| Import | Inhoud |
|--------|--------|
| `@repo/adricore/blocks` | Layout- en form-componenten. |
| `@repo/adricore/metadata` | Metadata classes: `ObjectMetadata`, `TabMetadata`, `AppMetadata`, velden, relaties, registries, exceptions. |
| `@repo/adricore/platform` | Tab-helpers (`getTabBySlug`, `getTabHref`). |

## Docs (generiek)

- [Nieuwe tabel / object checklist](docs/new-table.md)
- [List- en detail UI (Blocks)](docs/ui-list-detail.md)
