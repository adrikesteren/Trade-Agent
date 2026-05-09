# Dashboard UI conventions (Salesforce-inspired)

List and detail screens under `apps/web/src/app/dashboard/**` follow **Salesforce Lightning-style** patterns implemented in `@repo/blocks`. New or refactored pages should stay consistent so the product feels coherent.

## List views (object list / grid)

Treat each index route as a **Lightning list view**: chrome around the header, object tile, view name, metadata strip, toolbar, then the table or content.

### Use these building blocks

| Piece | Component / API | Notes |
|--------|------------------|--------|
| Page header | `PageHeader` with `variant="list"` | Not the default title bar. |
| Object tile | `ListViewObjectIcon` (`letter` or `children`) | Purple gradient square, like SF object icon. |
| List name row | `title`, optional `titleAddon` | e.g. `ListViewTitlePickerPlaceholder` (chevron + pin) until a real view picker exists. |
| Context line | `eyebrow` (small) + large `title` | e.g. eyebrow `Markets`, title `Bitvavo EUR`. |
| Summary | `summary` | Plain text line: counts, sort, filters, e.g. `12 listings · Sorted by Market Cap · Max 500 rows`. |
| Toolbar | `toolbar={<ListViewPlaceholderToolbar />}` or custom `ListViewToolbar` | Search field + icon row (settings, grid, refresh, …). |
| Row actions | `listViewOutlineActionClass` on `Link` | “New / Import” style outline actions, not only muted links. |

Shared helper (optional): `apps/web/src/components/dashboard-list-view-header.tsx` wraps the common list header for simple JSON/debug lists.

### Reference implementations

- Rich list: `apps/web/src/app/dashboard/markets/page.tsx`
- Catalog lists: `assets/page.tsx`, `exchanges/page.tsx`
- Automation: `sync-runs/page.tsx`
- Trading/automation stubs: pages using `DashboardListViewHeader`

Do **not** revert list pages to a bare `PageHeader` without `variant="list"` unless the route is intentionally not a list screen.

---

## Record detail pages (single record)

Treat each `*/[id]/page.tsx` (or similar dynamic segment) as a **Lightning record page**: soft page background, header with object icon and key fields, white primary card, stacked label/value fields.

### Use these building blocks

| Piece | Component / API | Notes |
|--------|------------------|--------|
| Page shell | `RecordDetailLayout` | Sets page background (`--bk-color-page`). |
| Header | `PageHeader` with `variant="detail"` | Optional `icon` (`ListViewObjectIcon`), optional `highlights` (compact `Output` row under title). |
| Primary card | `RecordDetailCard` | White card; put sections inside. |
| Sections | `RecordDetailSection` | Uppercase section title (SF-style band). |
| Field grid | `RecordDetailGrid` + `Output` | Two columns from `sm` up; use `span="full"` for long values (IDs, JSON). |
| FK / related record | `Output` with `lookup={{ href, name }}` or `record={{ pathPrefix, id, name }}` | `pathPrefix` is the app path without trailing slash, e.g. `/dashboard/assets`. |

### `Output` types

Use `type` for formatting: `text`, `number`, `boolean`, `datetime`, **`codeblock`** (scrollable `<pre><code>` — **only** for JSON / long blobs such as market `metadata`), `empty` (always em dash). Lookups override plain text when `lookup` or `record` is set.

Record IDs, tickers, exchange codes, job keys, etc. are **normal fields** → use **`text`** (same body typography as Name / Kind). Do not use a special “code” style for those labels.

### Reference implementations

- `apps/web/src/app/dashboard/assets/[assetId]/page.tsx`
- `apps/web/src/app/dashboard/exchanges/[exchangeId]/page.tsx`
- `apps/web/src/app/dashboard/markets/[marketId]/page.tsx`
- `apps/web/src/app/dashboard/sync-runs/[id]/page.tsx`

Styling lives in `packages/blocks/src/styles/blocks.css` (search for `bk-listview`, `bk-record-detail`, `bk-output`).

---

## For AI / automation agents

When adding or editing dashboard routes:

1. **List route** → apply the list view checklist above; reuse `DashboardListViewHeader` when the page is a simple data dump.
2. **Detail route** → apply the detail checklist; use `Output` + `record`/`lookup` for every foreign key that has a detail URL in this app.
3. Prefer extending `@repo/blocks` over one-off Tailwind in pages when the pattern is reusable.

Point agents at this file when working under `apps/web/src/app/dashboard/**` or `packages/blocks/**`.
