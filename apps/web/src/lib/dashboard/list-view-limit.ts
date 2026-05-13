/** Max rows shown in dashboard table list views and related-record lists. */
export const DASHBOARD_LIST_VIEW_LIMIT = 50;

/**
 * Raw `trading.signals` rows loaded before in-page ranking (one bar × many markets × agents easily exceeds 2500).
 * RLS still applies; only caps payload size for the list route.
 */
export const SIGNALS_LIST_RAW_FETCH_CAP = 20_000;

/** Salesforce-style related list: first N rows on a record page before “View all”. */
export const RECORD_RELATED_LIST_PREVIEW_ROWS = 10;

/** In-page expanded ledger on executor detail (`?ledger=all`). */
export const EXECUTOR_LEDGER_FULL_FETCH_CAP = 500;
