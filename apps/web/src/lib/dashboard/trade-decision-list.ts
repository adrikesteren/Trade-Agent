import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";

/** Fetch pool before per-market dedupe (same as trade decisions list view). */
export const TRADE_DECISIONS_FETCH_POOL = 400;

/** Executor detail only needs a pool to pick 10 preview rows after sort/dedupe. */
export const EXECUTOR_DETAIL_TRADE_DECISION_POOL = 120;

type SortableDecision = { approved: boolean; close_time: string };

/** Approved first, then bar close descending. */
export function compareTradeDecisionsListView(a: SortableDecision, b: SortableDecision): number {
  const ap = a.approved ? 1 : 0;
  const bp = b.approved ? 1 : 0;
  if (bp !== ap) return bp - ap;
  return Date.parse(b.close_time) - Date.parse(a.close_time);
}

/** After sorting, first row per `market_id` wins (best = approved + latest close). */
export function uniqueTradeDecisionsByMarket<T extends { market_id: string }>(sorted: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of sorted) {
    if (seen.has(row.market_id)) continue;
    seen.add(row.market_id);
    out.push(row);
  }
  return out;
}

export function dedupeTradeDecisionsForListView<T extends SortableDecision & { market_id: string }>(raw: T[]): T[] {
  const sorted = [...raw].sort(compareTradeDecisionsListView);
  return uniqueTradeDecisionsByMarket(sorted);
}

export function buildTradeDecisionListViewRows<T extends SortableDecision & { market_id: string }>(
  raw: T[],
  displayLimit: number = DASHBOARD_LIST_VIEW_LIMIT,
): T[] {
  return dedupeTradeDecisionsForListView(raw).slice(0, displayLimit);
}
