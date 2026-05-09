import {
  SyncRunsLiveClient,
  type SyncRunRow,
  type SyncRunsOverviewTemplate,
} from "@/components/sync-runs-live-client";
import { SYNC_RUN_DASHBOARD_JOB_KEYS } from "@/lib/dashboard/sync-run-dashboard-jobs";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  COINGECKO_SYNC_JOB_COIN_ID,
  COINGECKO_SYNC_JOB_METRICS,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  getCandlesSyncIntervalMs,
  getCoingeckoCoinIdSyncIntervalMs,
  getCoingeckoMetricsSyncIntervalMs,
  getMarketsSyncIntervalMs,
} from "@/lib/markets/sync-schedule";
import { MANAGED_QSTASH_SCHEDULES } from "@/lib/workers/qstash-managed-schedules";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

function qstashScheduleIdForJob(jobKey: string): string | null {
  return MANAGED_QSTASH_SCHEDULES.find((s) => s.jobKey === jobKey)?.scheduleId ?? null;
}

const OVERVIEW_TEMPLATE: SyncRunsOverviewTemplate[] = [
  {
    jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
    label: "EUR market catalog",
    provider: "Bitvavo",
    intervalMs: getMarketsSyncIntervalMs(),
    action: "bitvavo-markets",
    qstashScheduleId: qstashScheduleIdForJob(BITVAVO_SYNC_JOB_MARKETS_EUR),
  },
  {
    jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
    label: "EUR candles sweep",
    provider: "Bitvavo",
    intervalMs: getCandlesSyncIntervalMs(),
    action: "bitvavo-candles",
    qstashScheduleId: qstashScheduleIdForJob(BITVAVO_SYNC_JOB_CANDLES_EUR),
  },
  {
    jobKey: COINGECKO_SYNC_JOB_METRICS,
    label: "Asset fundamentals (USD)",
    provider: "CoinGecko",
    intervalMs: getCoingeckoMetricsSyncIntervalMs(),
    action: "coingecko",
    qstashScheduleId: qstashScheduleIdForJob(COINGECKO_SYNC_JOB_METRICS),
  },
  {
    jobKey: COINGECKO_SYNC_JOB_COIN_ID,
    label: "CoinGecko coin id (catalog)",
    provider: "CoinGecko",
    intervalMs: getCoingeckoCoinIdSyncIntervalMs(),
    action: "coingecko-coin-id",
    qstashScheduleId: qstashScheduleIdForJob(COINGECKO_SYNC_JOB_COIN_ID),
  },
];

export default async function SyncRunsPage() {
  const supabase = await createClient();

  const { data: runRows, error: runsError } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, ended_at, reason, metadata")
    .in("job_key", [...SYNC_RUN_DASHBOARD_JOB_KEYS])
    .order("created_at", { ascending: false })
    .limit(200);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Sync runs</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            All jobs log to <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">sync_runs</code> (append-only).
            Use the table for status; history below updates live while this tab stays open.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Link
            href="/dashboard/markets"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Markets
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      <SyncRunsLiveClient
        initialRuns={runsSafe}
        initialError={runsError?.message ?? null}
        overviewTemplate={OVERVIEW_TEMPLATE}
      />
    </div>
  );
}
