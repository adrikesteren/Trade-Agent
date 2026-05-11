/**
 * Salesforce-style object metadata: maps a URL slug to a physical table and defines related lists.
 * Add one file per object under `apps/web/src/models/` (e.g. `assets.ts`) and export a constant
 * implementing this shape for discoverability and codegen-style checklists (see root AGENTS.md).
 */
export type ObjectRelationDef = {
  /** URL segment under the parent record, e.g. `orders` → `/executors/:id/orders` */
  relatedSlug: string;
  /** Column on the child table pointing at the parent record */
  fkColumn: string;
  /** Postgres schema + table for the related list query */
  target: { schema: string; table: string };
};

export type CatalogObjectDef = {
  /** URL segment (often plural kebab-case), e.g. `signal-agents` */
  slug: string;
  /** Human label for headers */
  label: string;
  /** Primary key column */
  idColumn: string;
  schema: string;
  table: string;
  /** Declared related lists used for nested routes and filters */
  relations?: ObjectRelationDef[];
};
