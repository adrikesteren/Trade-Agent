import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  COINGECKO_SYNC_JOB_COIN_ID,
  COINGECKO_SYNC_JOB_METRICS,
} from "@/lib/markets/record-bitvavo-sync-status";
import { OPS_JOB_BITVAVO_RECONCILE, OPS_JOB_RISK_DAILY_RESET } from "@/lib/workers/ops-job-keys";

/** Must match `scripts/qstash-schedules.mjs` — stable Upstash schedule IDs. */
export const MANAGED_QSTASH_SCHEDULES: readonly { scheduleId: string; jobKey: string }[] = [
  { scheduleId: "trade-agent-bitvavo-candles-eur", jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR },
  { scheduleId: "trade-agent-bitvavo-markets-eur", jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR },
  { scheduleId: "trade-agent-coingecko-metrics", jobKey: COINGECKO_SYNC_JOB_METRICS },
  { scheduleId: "trade-agent-coingecko-coin-id", jobKey: COINGECKO_SYNC_JOB_COIN_ID },
  { scheduleId: "trade-agent-risk-daily-reset", jobKey: OPS_JOB_RISK_DAILY_RESET },
  { scheduleId: "trade-agent-bitvavo-reconcile", jobKey: OPS_JOB_BITVAVO_RECONCILE },
] as const;

const MANAGED_IDS = new Set(MANAGED_QSTASH_SCHEDULES.map((s) => s.scheduleId));

export function isManagedQstashScheduleId(scheduleId: string): boolean {
  return MANAGED_IDS.has(scheduleId);
}
