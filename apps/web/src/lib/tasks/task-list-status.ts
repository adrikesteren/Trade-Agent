import { pickSearchParamString } from "@/lib/dashboard/list-pagination";

import { DASHBOARD_TASK_EDITABLE_STATUSES, labelDashboardTaskStatus } from "./task-statuses";

/** Query value for “no status filter”. */
export const TASK_LIST_STATUS_QUERY_ALL = "all";

/** Default list filter when `status` is absent from the URL. */
export const TASK_LIST_STATUS_DEFAULT = "open";

const MAX_STATUS_LEN = 128;

export type TaskListStatusFilter =
  | { mode: "all" }
  | { mode: "eq"; status: string };

function sanitizeStatusToken(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > MAX_STATUS_LEN) return null;
  // Allow typical task status tokens; DB column is text — keep permissive but block obvious junk.
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

/**
 * Parses `?status=` for the tasks list.
 * - Missing / empty → filter **open** (default).
 * - `all` (case-insensitive) → no status filter.
 * - Otherwise → exact match after sanitization; invalid tokens fall back to **open**.
 */
export function parseTaskListStatusFilter(
  sp: Record<string, string | string[] | undefined>,
): TaskListStatusFilter {
  const raw = pickSearchParamString(sp, "status");
  if (!raw) {
    return { mode: "eq", status: TASK_LIST_STATUS_DEFAULT };
  }
  if (raw.toLowerCase() === TASK_LIST_STATUS_QUERY_ALL) {
    return { mode: "all" };
  }
  const cleaned = sanitizeStatusToken(raw);
  if (!cleaned) {
    return { mode: "eq", status: TASK_LIST_STATUS_DEFAULT };
  }
  return { mode: "eq", status: cleaned };
}

/** Keys preserved in pagination links (omit default open for clean URLs). */
export function taskListStatusExtraQuery(filter: TaskListStatusFilter): Record<string, string | undefined> {
  if (filter.mode === "all") {
    return { status: TASK_LIST_STATUS_QUERY_ALL };
  }
  if (filter.status === TASK_LIST_STATUS_DEFAULT) {
    return {};
  }
  return { status: filter.status };
}

export function taskListStatusSortLine(filter: TaskListStatusFilter): string {
  if (filter.mode === "all") {
    return "Status: all · root tasks only · created (newest first)";
  }
  return `Status: ${labelDashboardTaskStatus(filter.status)} · root tasks only · created (newest first)`;
}

/** Ordered status options for the filter control (includes every distinct value in the DB + canonical set). */
export function buildTaskListStatusSelectOptions(distinctFromDb: string[]): { value: string; label: string }[] {
  const merged = new Set<string>([...DASHBOARD_TASK_EDITABLE_STATUSES, ...distinctFromDb]);
  const sorted = [...merged].sort((a, b) => a.localeCompare(b));
  return sorted.map((value) => ({ value, label: labelDashboardTaskStatus(value) }));
}

/** Normalizes `rpc("dashboard_task_root_statuses")` across PostgREST response shapes. */
export function normalizeDashboardTaskRootStatusesRpcResult(data: unknown): string[] {
  if (!Array.isArray(data) || data.length === 0) return [];
  const first = data[0];
  if (typeof first === "string") {
    return data.filter((x): x is string => typeof x === "string");
  }
  if (first && typeof first === "object") {
    const row = first as Record<string, unknown>;
    const scalarKey =
      "dashboard_task_root_statuses" in row
        ? "dashboard_task_root_statuses"
        : "status" in row
          ? "status"
          : Object.keys(row).length === 1
            ? String(Object.keys(row)[0])
            : null;
    if (!scalarKey) return [];
    const out: string[] = [];
    for (const item of data) {
      if (item && typeof item === "object" && scalarKey in (item as object)) {
        const v = (item as Record<string, unknown>)[scalarKey];
        if (typeof v === "string" && v) out.push(v);
      }
    }
    return out;
  }
  return [];
}
