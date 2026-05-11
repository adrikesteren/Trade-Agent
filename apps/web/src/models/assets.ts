import type { CatalogObjectDef } from "./types";

/** Example object model — catalog base instruments. */
export const assetsObject: CatalogObjectDef = {
  slug: "assets",
  label: "Assets",
  idColumn: "id",
  schema: "catalog",
  table: "assets",
  relations: [
    {
      relatedSlug: "markets",
      fkColumn: "asset_id",
      target: { schema: "catalog", table: "markets" },
    },
  ],
};
