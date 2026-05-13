# Nieuwe tabel / object (checklist)

Gebruik samen met je eigen AGENTS-/contributor-docs en je UI-conventies.

1. **Migratie** (in jouw project): tabel met **standaardkolommen**: `id` (uuid, PK), `name` (text), `created_by` / `updated_by` (uuid), `created_at` / `updated_at` (timestamptz, `updated_at` bij wijziging) + RLS/policies.
2. **Metadata (verplicht patroon)**: in **jouw app** een **subclass van [`ObjectMetadata`](../src/metadata/object-metadata.ts)**. Voeg alleen object-specifieke velden en childRelationships toe. Standaardvelden worden via de base class geërfd.
3. **List page**: [`ListViewLayout`](../src/blocks/components/list-view-layout.tsx), [`PageHeader`](../src/blocks/components/page-header.tsx) variant list; optioneel een app-specifieke list-header.
4. **Detail page**: [`DetailPageLayout`](../src/blocks/components/detail-page-layout.tsx) + tabs/actions volgens je UI-conventies.
5. **Routes** in je app-router; tab-gestuurde lijsten: eigen registry + dynamische routes in **jouw** codebase.
6. **Nav**: definieer `AppMetadata` (tabs) in **jouw** app — niet in AdriCore — en koppel die aan je nav-component; gebruik [`getTabBySlug` / `getTabHref`](../src/platform/tab-navigation.ts) van `@repo/adricore/platform`.
7. **Cache**: `revalidatePath` / `revalidateTag` waar je framework gebruikt.
8. **Tests** / workers naar behoefte.

Types: [`@repo/adricore/metadata`](../src/metadata/index.ts), platform: [`@repo/adricore/platform`](../src/platform/index.ts).
