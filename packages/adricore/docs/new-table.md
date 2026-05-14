# Nieuwe tabel / object (checklist)

Gebruik samen met je eigen AGENTS-/contributor-docs en je UI-conventies.

1. **Migratie** (in jouw project): tabel met **standaardkolommen**: `id` (uuid, PK), `name` (text), `created_by` / `updated_by` (uuid), `created_at` / `updated_at` (timestamptz, `updated_at` bij wijziging) + RLS/policies.
2. **Metadata (verplicht patroon)**: in **jouw app** een **subclass van [`ObjectMetadata`](../src/metadata/object-metadata.tsx)**. Voeg alleen object-specifieke velden en childRelationships toe. Standaardvelden worden via de base class geërfd.
3. **List page**: [`ListViewLayout`](../src/blocks/patterns/list-view/list-view-layout.tsx) + `model.CreateListPageHeader(...)` voor de header. Optioneel een app-specifieke list-header-wrapper die hieraan delegeert.
4. **Detail page**: [`DetailPageLayout`](../src/blocks/patterns/record-page/detail-page-layout.tsx) + `model.CreateDetailPageHeader({ record, actions, highlights })`. Velden: `model.CreateFieldOutput(record, "field_api_name")` of `field.CreateOutput(...)` direct.
5. **Routes** in je app-router; tab-gestuurde lijsten: eigen registry + dynamische routes in **jouw** codebase.
6. **Nav**: definieer `AppMetadata` (tabs) in **jouw** app — niet in AdriCore — en koppel die aan je nav-component; gebruik [`getTabBySlug` / `getTabHref`](../src/platform/tab-navigation.ts) van `@repo/adricore/platform`.
7. **Cache**: `revalidatePath` / `revalidateTag` waar je framework gebruikt.
8. **Tests** / workers naar behoefte.

## Metadata-driven blocks API

Elke metadata-class biedt **OOP render-methodes** in twee vormen:

- `to*Props(...)` → pure data (platform-onafhankelijk).
- `Create*(...)` → JSX-wrapper die een AdriCore Block teruggeeft.

Salesforce SObject-stijl: vraag de metadata om zichzelf te renderen.

```tsx
// List header — geen handmatig icon nodig
{ExecutorsModel.CreateListPageHeader({ rowCount, sortLine, actions })}

// Detail header — title komt uit getRecordTitle(record)
{ExecutorsModel.CreateDetailPageHeader({ record, actions, highlights })}

// Single output (label + value + datatype-aware formatting)
{ExecutorsModel.CreateFieldOutput(record, "execution_mode")}

// Lookup output
{ExecutorsModel.fieldRegistry.registrations.get("wallet_id")!.CreateOutput(record.wallet_id, {
  record: { id: wallet.id, name: wallet.name },
})}

// Editable input
{field.CreateInput(value, (v) => setValue(v), { error })}

// Picklist badge
{statusField.picklist!.CreateBadge(record.status)}

// Related list
{ExecutorsModel.childRelationships.registrations.get("orders")!.CreateRelatedList({ id: executor.id }, orderRows)}
```

Volledige tabel met methodes per class staat in [ui-list-detail.md](./ui-list-detail.md).

Types: [`@repo/adricore/metadata`](../src/metadata/index.ts), platform: [`@repo/adricore/platform`](../src/platform/index.ts).
