import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";

export const LIST_PAGE_QUERY_KEY = "page";

export function pickSearchParamString(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) {
    const s = v[0]?.trim();
    return s || undefined;
  }
  if (typeof v === "string") {
    const s = v.trim();
    return s || undefined;
  }
  return undefined;
}

export function parseListPage(sp: Record<string, string | string[] | undefined> | undefined): number {
  const raw = pickSearchParamString(sp ?? {}, LIST_PAGE_QUERY_KEY);
  const n = parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function rangeForPage(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function totalPages(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, pages: number): number {
  const p = pages < 1 ? 1 : pages;
  return Math.min(Math.max(1, page), p);
}

export type ListPaginationExtra = Record<string, string | undefined>;

/** Build URL for a list page; omits `page` when target is 1. */
export function buildListPageHref(pathname: string, targetPage: number, extras: ListPaginationExtra): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extras)) {
    if (v === undefined || v === "") continue;
    if (k === LIST_PAGE_QUERY_KEY) continue;
    p.set(k, v);
  }
  if (targetPage > 1) {
    p.set(LIST_PAGE_QUERY_KEY, String(targetPage));
  }
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function defaultListPageSize(): number {
  return DASHBOARD_LIST_VIEW_LIMIT;
}
