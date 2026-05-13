/**
 * Map polymorphic `related_schema` / `related_table` / `related_id` to an in-app record URL, when one exists.
 * Returns `null` when the dashboard has no `[id]` detail route for that row (e.g. list-only objects).
 */
export function resolveRelatedHref(
  relatedSchema: string,
  relatedTable: string,
  relatedId: string,
): string | null {
  const schema = relatedSchema.trim().toLowerCase();
  const table = relatedTable.trim().toLowerCase();
  const id = relatedId.trim();
  if (!id) return null;

  if (schema === "catalog" && table === "assets") return `/assets/${id}`;
  if (schema === "catalog" && table === "markets") return `/markets/${id}`;
  if (schema === "catalog" && table === "exchanges") return `/exchanges/${id}`;

  if (schema === "trading" && table === "signals") return `/signals/${id}`;
  if (schema === "trading" && table === "signal_agents") return `/signal-agents/${id}`;
  if (schema === "trading" && table === "decisions") return `/trade-decisions/${id}`;
  if (schema === "trading" && table === "orders") return `/orders/${id}`;
  if (schema === "trading" && table === "executors") return `/executors/${id}`;

  if (schema === "automation" && table === "sync_runs") return `/sync-runs/${id}`;

  if (schema === "public" && table === "tasks") return `/tasks/${id}`;

  return null;
}
