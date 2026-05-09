import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  COINGECKO_SYNC_JOB_COIN_ID,
  COINGECKO_SYNC_JOB_METRICS,
} from "@/lib/markets/record-bitvavo-sync-status";

/** `sync_runs.job_key` values shown on the dashboard sync runs list and detail pages. */
export const SYNC_RUN_DASHBOARD_JOB_KEYS = [
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  COINGECKO_SYNC_JOB_METRICS,
  COINGECKO_SYNC_JOB_COIN_ID,
] as const;

export type SyncRunDashboardJobKey = (typeof SYNC_RUN_DASHBOARD_JOB_KEYS)[number];
