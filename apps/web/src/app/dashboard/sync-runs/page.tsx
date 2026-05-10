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
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { MANAGED_QSTASH_SCHEDULES } from "@/lib/workers/qstash-managed-schedules";
import { createClient } from "@/lib/supabase/server";
import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
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
  const localePrefs = await getUserLocalePreferences();

  const { data: runRows, error: runsError } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, ended_at, reason, metadata")
    .in("job_key", [...SYNC_RUN_DASHBOARD_JOB_KEYS])
    .order("created_at", { ascending: false })
    .limit(200);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];
  const n = runsSafe.length;
  const summaryBits = [
    `${n} run${n === 1 ? "" : "s"}`,
    "Sorted by Created date",
    "Dashboard jobs only",
    "Max 200 rows",
  ];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="S" />}
        eyebrow="Sync"
        title="Run history"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            All jobs log to <code className="bk-code">sync_runs</code> (append-only). Use the table for status;
            history below updates live while this tab stays open.
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <>
            <Link href="/dashboard/markets" className={listViewOutlineActionClass}>
              Markets
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />

      <SyncRunsLiveClient
        initialRuns={runsSafe}
        initialError={runsError?.message ?? null}
        overviewTemplate={OVERVIEW_TEMPLATE}
        localePrefs={localePrefs}
      />
    </div>
  );
}
