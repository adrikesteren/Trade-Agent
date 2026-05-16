# Dashboard UI conventions (Salesforce-inspired)

List and detail screens under `apps/web/src/app/(app)/**` follow **Salesforce Lightning-style** patterns implemented in `@adrikesteren/adricore/blocks`. New or refactored pages should stay consistent so the product feels coherent.

## List views (object list / grid)

Treat each index route as a **Lightning list view**: chrome around the header, object tile, view name, metadata strip, toolbar, then the table or content.

### Use these building blocks

| Piece | Component / API | Notes |
|--------|------------------|--------|
| Page header | `PageHeader` with `variant="list"` | Not the default title bar. |
| Object tile | `ListViewObjectIcon` (`letter` or `children`) | Purple gradient square, like SF object icon. |
| List name row | `title`, optional `titleAddon` | e.g. `ListViewTitlePickerPlaceholder` (chevron + pin) until a real view picker exists. |
| Summary | `summary` | Plain text line: counts, sort, filters, e.g. `12 listings · Sorted by Market Cap · Max 500 rows`. |
| Toolbar | `toolbar={<ListViewPlaceholderToolbar />}` or custom `ListViewToolbar` | Search field + icon row (settings, grid, refresh, …). |
| Row actions | `listViewOutlineActionClass` on `Link` | “New / Import” style outline actions, not only muted links. |

Shared helper (optional): `apps/web/src/components/object-list-view-header.tsx` wraps the common list header for simple JSON/debug lists.

### Reference implementations

- Rich list: `apps/web/src/app/(app)/markets/page.tsx`
- Catalog lists: `assets/page.tsx`, `exchanges/page.tsx`
- Automation: `sync-runs/page.tsx`
- System settings (top-level nav): `system-settings/page.tsx` (list for `public.system_settings`)
- Account locale: `me/preferences/page.tsx` (display formats; not “system settings”)
- Trading/automation stubs: pages using `ObjectListViewHeader`

Do **not** revert list pages to a bare `PageHeader` without `variant="list"` unless the route is intentionally not a list screen.

---

## Record detail pages (single record)

Treat each `*/[id]/page.tsx` (or similar dynamic segment) as a **Lightning record page**: soft page background, full-width header, then main content (and optional right column).

### Page shell: `DetailPageLayout`

Wrap the whole screen in **`DetailPageLayout`** from `@adrikesteren/adricore/blocks`. It composes `RecordDetailLayout` (page background) and defines three slots:

| Slot | Role |
|------|--------|
| `header` | Full width: typically `PageHeader` with `variant="detail"` (or another top chrome such as `ObjectListViewHeader` where that route still uses list-style chrome). |
| `content` | Main column: cards, charts, tables, alerts that belong below the header. |
| `sidebar` | Optional. From **48rem** viewport width, the row under the header is always **60%** main / **40%** sidebar (`3fr` / `2fr`). Below that width, main and sidebar **stack** (main first). If `sidebar` is omitted or `null`, the right column is still reserved on wide screens as a dashed placeholder; on narrow screens it is hidden so you do not get a blank block under the content. |

Pass horizontal padding on `DetailPageLayout` itself (e.g. `className="bk-container px-1"`). `bk-container` is full width of the main pane; add `bk-container_lg` only if you rely on that class name for consistency (it no longer caps width).

### Use these building blocks (inside the slots)

| Piece | Component / API | Notes |
|--------|------------------|--------|
| Record chrome (inside `header`) | `PageHeader` with `variant="detail"` | Optional `icon` (`ListViewObjectIcon`), optional `highlights` (compact `Output` row under title). |
| Primary card | `RecordDetailCard` | White card; put sections inside. |
| Sections | `RecordDetailSection` | Uppercase section title (SF-style band). |
| Field grid | `RecordDetailGrid` + `Output` | Two columns from `sm` up; use `span="full"` for long values (IDs, JSON). |
| FK / related record | `Output` with `lookup={{ href, name }}` or `record={{ pathPrefix, id, name }}` | `pathPrefix` is the app path without trailing slash, e.g. `/assets`. |
| Related list (child records) | `RecordRelatedList` | Pass `items`, `getKey`, `renderRow`, optional `totalCount` from `count: "exact"`, `previewLimit` (default 10), and `viewAllHref` for the full list. Renders a section header with outline **View all** when `totalCount > previewLimit`. |

`RecordDetailLayout` remains exported for edge cases; **new detail routes should use `DetailPageLayout`** so header / 60–40 behavior stays consistent.

### `Output` types

Use `type` for formatting: `text`, `number`, `boolean`, `datetime`, **`codeblock`** (scrollable `<pre><code>` — **only** for JSON / long blobs such as market `metadata`), `empty` (always em dash). Lookups override plain text when `lookup` or `record` is set.

Record IDs, tickers, exchange codes, job keys, etc. are **normal fields** → use **`text`** (same body typography as Name / Kind). Do not use a special “code” style for those labels.

### Reference implementations

- `apps/web/src/app/(app)/assets/[slug]/page.tsx`
- `apps/web/src/app/(app)/exchanges/[id]/page.tsx`
- `apps/web/src/app/(app)/markets/[id]/page.tsx`
- `apps/web/src/app/(app)/sync-runs/[id]/page.tsx`
- `apps/web/src/app/(app)/system-settings/[key]/page.tsx`
- `apps/web/src/app/(app)/signal-agents/[id]/page.tsx`
- `apps/web/src/app/(app)/executors/[id]/page.tsx`

Styling lives in `packages/adricore/src/blocks/styles/blocks.css` (search for `bk-listview`, `bk-record-detail`, `bk-detail-page-layout`, `bk-output`).

---

## For AI / automation agents

When adding or editing dashboard routes:

1. **List route** → apply the list view checklist above; reuse `ObjectListViewHeader` when the page is a simple data dump.
2. **Detail route** → wrap with `DetailPageLayout` (`header` / `content` / optional `sidebar`); apply the detail checklist; use `Output` + `record`/`lookup` for every foreign key that has a detail URL in this app.
3. Prefer extending `@adrikesteren/adricore/blocks` over one-off Tailwind in pages when the pattern is reusable.

Point agents at this file when working under `apps/web/src/app/(app)/**` or `packages/adricore/src/blocks/**`.
