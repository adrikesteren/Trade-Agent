import { SyncJobsOverviewTable, type SyncJobsOverviewRow } from "@/components/sync-jobs-overview-table";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  COINGECKO_SYNC_JOB_METRICS,
  type BitvavoSyncJobStatus,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  getCandlesSyncIntervalMs,
  getCoingeckoMetricsSyncIntervalMs,
  getMarketsSyncIntervalMs,
} from "@/lib/markets/sync-schedule";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type SyncRunRow = {
  id: string;
  job_key: string;
  status: string;
  trigger_source: string | null;
  created_at: string | null;
  completed_at: string | null;
  ended_at: string | null;
};

function lastCompletedAtForJob(rows: SyncRunRow[], jobKey: string): string | null {
  for (const r of rows) {
    if (r.job_key === jobKey && r.status === "completed" && r.completed_at) return r.completed_at;
  }
  return null;
}

const SYNC_JOB_KEYS = [
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  COINGECKO_SYNC_JOB_METRICS,
] as const;

export default async function SyncRunsPage() {
  const supabase = await createClient();

  const { data: runRows, error: runsError } = await supabase
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, completed_at, ended_at")
    .in("job_key", [...SYNC_JOB_KEYS])
    .order("created_at", { ascending: false })
    .limit(200);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];
  const latestByJob = new Map<string, SyncRunRow>();
  for (const row of runsSafe) {
    if (!latestByJob.has(row.job_key)) latestByJob.set(row.job_key, row);
  }

  const marketsLatest = latestByJob.get(BITVAVO_SYNC_JOB_MARKETS_EUR) ?? null;
  const candlesLatest = latestByJob.get(BITVAVO_SYNC_JOB_CANDLES_EUR) ?? null;
  const coingeckoLatest = latestByJob.get(COINGECKO_SYNC_JOB_METRICS) ?? null;

  const marketsCompletedAt = lastCompletedAtForJob(runsSafe, BITVAVO_SYNC_JOB_MARKETS_EUR);
  const candlesCompletedAt = lastCompletedAtForJob(runsSafe, BITVAVO_SYNC_JOB_CANDLES_EUR);
  const coingeckoCompletedAt = lastCompletedAtForJob(runsSafe, COINGECKO_SYNC_JOB_METRICS);

  const recentRuns = runsSafe.slice(0, 40);

  const overviewRows: SyncJobsOverviewRow[] = [
    {
      jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
      label: "EUR market catalog",
      provider: "Bitvavo",
      status: (marketsLatest?.status as BitvavoSyncJobStatus | null) ?? null,
      lastStartedAt: marketsLatest?.created_at ?? null,
      lastSuccessAt: marketsCompletedAt,
      intervalMs: getMarketsSyncIntervalMs(),
      action: "bitvavo-markets",
    },
    {
      jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
      label: "EUR candles sweep",
      provider: "Bitvavo",
      status: (candlesLatest?.status as BitvavoSyncJobStatus | null) ?? null,
      lastStartedAt: candlesLatest?.created_at ?? null,
      lastSuccessAt: candlesCompletedAt,
      intervalMs: getCandlesSyncIntervalMs(),
      action: null,
    },
    {
      jobKey: COINGECKO_SYNC_JOB_METRICS,
      label: "Asset fundamentals (USD)",
      provider: "CoinGecko",
      status: (coingeckoLatest?.status as BitvavoSyncJobStatus | null) ?? null,
      lastStartedAt: coingeckoLatest?.created_at ?? null,
      lastSuccessAt: coingeckoCompletedAt,
      intervalMs: getCoingeckoMetricsSyncIntervalMs(),
      action: "coingecko",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Sync runs</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            All jobs log to <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">sync_runs</code> (append-only).
            Use the table for status; history is below.
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

      <SyncJobsOverviewTable rows={overviewRows} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent sync runs</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Latest attempts across Bitvavo and CoinGecko jobs (running → completed or failed).
        </p>
        {runsError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{runsError.message}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-2">Job</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Trigger</th>
                  <th className="py-2 pr-2">Started</th>
                  <th className="py-2 pr-2">Ended</th>
                  <th className="py-2 pr-2">Completed (success)</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2 font-mono text-zinc-800 dark:text-zinc-200">{r.job_key}</td>
                    <td className="py-1.5 pr-2">{r.status}</td>
                    <td className="py-1.5 pr-2">{r.trigger_source ?? "—"}</td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.ended_at
                        ? new Date(r.ended_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.completed_at
                        ? new Date(r.completed_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                  </tr>
                ))}
                {!recentRuns.length ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      No runs yet. Use <strong>Sync now</strong> on Bitvavo or CoinGecko above, or run workers / local
                      dev timers.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
