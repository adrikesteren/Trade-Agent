# List- en detailpagina’s (Blocks)

Gebruik je eigen UI-/dashboard-conventies naast deze componenten.

## List

- Shell: [`ListViewLayout`](../src/blocks/components/list-view-layout.tsx)
- Header: [`PageHeader`](../src/blocks/components/page-header.tsx) met `variant="list"`; optioneel een app-specifieke list-header-wrapper
- Toolbar / search: [`ListViewToolbar`](../src/blocks/components/list-view-toolbar.tsx), placeholders waar nodig

## Detail

- Shell: [`DetailPageLayout`](../src/blocks/components/detail-page-layout.tsx) met `header` / `content` / optioneel `sidebar`
- Record: [`RecordDetailCard`](../src/blocks/components/record-detail-layout.tsx), [`RecordDetailSection`](../src/blocks/components/record-detail-section.tsx), [`Output`](../src/blocks/components/output.tsx)

Importeer UI vanuit `@repo/adricore/blocks`.
