# List- en detailpagina's (Blocks)

Gebruik je eigen UI-/dashboard-conventies naast deze componenten.

## Salesforce-stijl: render via metadata

Vanaf de [metadata-driven blocks API](./new-table.md#metadata-driven-blocks-api) draait alle UI rond instance-methodes op je `ObjectMetadata` / `ObjectFieldMetadata` / `ObjectRelationshipMetadata` / `PicklistMetadata`. Elke render-methode bestaat in twee vormen:

- `to*Props(...)` — pure data, platform-onafhankelijk (geschikt voor RN of andere renderers).
- `Create*(...)` — dunne JSX-wrapper die een AdriCore Block teruggeeft.

Belangrijkste methodes:

| Class | `to*Props()` | `Create*()` | Levert |
|-------|--------------|-------------|--------|
| `ObjectFieldMetadata` | `toOutputProps(value, opts?)` | `CreateOutput(value, opts?)` | `<Output>` |
| `ObjectFieldMetadata` | `toInputProps(value, opts?)` | `CreateInput(value, onChange, opts?)` | `<FormElement>` + control |
| `ObjectFieldMetadata` | `toColumnDef()` | `CreateColumn()` | `ColumnDef` (table-cel descriptor) |
| `ObjectMetadata` | `toListPageHeaderProps(opts)` | `CreateListPageHeader(opts)` | `<PageHeader variant="list">` |
| `ObjectMetadata` | `toDetailPageHeaderProps(opts)` | `CreateDetailPageHeader(opts)` | `<PageHeader variant="detail">` |
| `ObjectMetadata` | `toColumns(fieldApiNames?)` | `CreateColumns(fieldApiNames?)` | `ColumnDef[]` |
| `ObjectMetadata` | — | `CreateObjectIcon(opts?)` | `<ListViewObjectIcon>` |
| `ObjectMetadata` | — | `CreateBreadcrumb(opts?)` | `<Breadcrumbs>` rooted op de list-view |
| `ObjectMetadata` | — | `CreateRowLink(record)` | `<a>` naar de detail-pagina |
| `ObjectMetadata` | — | `CreateFieldOutput(record, fieldApiName, opts?)` | `<Output>` voor één veld |
| `ObjectRelationshipMetadata` | `toLookupOutputProps(value, opts?)` | `CreateLookupOutput(value, opts?)` | `<Output type="lookup">` |
| `ObjectRelationshipMetadata` | `toRelatedListProps(parent, rows, opts?)` | `CreateRelatedList(parent, rows, opts?)` | `<RecordRelatedList>` |
| `ObjectRelationshipMetadata` | — | `getRelatedListHref(parentId)` | URL volgens `/{parentSlug}/{id}/{relatedSlug}` |
| `PicklistMetadata` | `toBadgeProps(value)` / `toSelectOptions()` | `CreateBadge(value)` | `<Badge>` |
| `IconMetadata` | — | `CreateIcon(opts?)` | `<ListViewObjectIcon>` |
| `RouteMetadata` | — | `getRecordHref(id)` | absolute href |

## List

- Shell: [`ListViewLayout`](../src/blocks/patterns/list-view/list-view-layout.tsx)
- Header (metadata-driven): roep `model.CreateListPageHeader(...)` aan, of gebruik de app-side wrapper die hieraan delegeert.
- Toolbar / search: [`ListViewToolbar`](../src/blocks/patterns/list-view/list-view-toolbar.tsx), placeholders waar nodig.

```tsx
// Page header from metadata: geen handmatig icon nodig.
{ExecutorsModel.CreateListPageHeader({
  rowCount: list.length,
  sortLine: `Page ${page} of ${pages} · ${totalCount} total`,
  actions: <Link href="/executors/new" className={listViewOutlineActionClass}>New executor</Link>,
})}
```

`toListPageHeaderProps` accepteert `{ rowCount, sortLine, summary?, actions?, uncapped?, maxRows?, titleAddon?, toolbar?, iconLetter?, icon?, className? }`. De title komt uit `label.plural`, het icon uit `CreateObjectIcon`.

## Detail

- Shell: [`DetailPageLayout`](../src/blocks/patterns/record-page/detail-page-layout.tsx) met `header` / `content` / optioneel `sidebar`.
- Header (metadata-driven): `model.CreateDetailPageHeader({ record, actions, highlights, subtitle })`.
- Velden: `model.CreateFieldOutput(record, "field_api_name")` of `field.CreateOutput(record[field.apiName], { formatDatetime })` voor een fijnere control over datums.
- Lookups: `field.CreateOutput(value, { record: { id, name } })` of (als je al een relationship object hebt) `relationship.CreateLookupOutput({ id, name })`.
- Related list: `relationship.CreateRelatedList(parent, rows)`.

```tsx
{ExecutorsModel.CreateDetailPageHeader({
  record,
  actions: <ExecutorActions record={record} />,
  highlights: (
    <>
      {ExecutorsModel.CreateFieldOutput(record, "execution_mode")}
      {ExecutorsModel.CreateFieldOutput(record, "enabled")}
    </>
  ),
})}
```

## Back-compat: `FieldRenderer`

`FieldRenderer.createOutput(field, value)` en `createInput(field, value, onChange, error?)` blijven werken; ze delegeren intern naar `field.CreateOutput` / `field.CreateInput`. Nieuwe code gebruikt liever de instance-methodes direct.

Importeer UI vanuit `@repo/adricore/blocks`, metadata-types vanuit `@repo/adricore/metadata`.
