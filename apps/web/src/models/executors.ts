import type { CatalogObjectDef } from "./types";

/** Example object model — trading executors with nested related lists implemented under `/executors/[id]/…`. */
export const executorsObject: CatalogObjectDef = {
  slug: "executors",
  label: "Executors",
  idColumn: "id",
  schema: "trading",
  table: "executors",
  relations: [
    { relatedSlug: "orders", fkColumn: "executor_id", target: { schema: "trading", table: "orders" } },
    {
      relatedSlug: "trade-decisions",
      fkColumn: "executor_id",
      target: { schema: "trading", table: "trade_decisions" },
    },
    { relatedSlug: "positions", fkColumn: "executor_id", target: { schema: "trading", table: "positions" } },
  ],
};
