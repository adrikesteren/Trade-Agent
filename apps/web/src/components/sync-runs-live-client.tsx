"use client";

import { SyncJobsOverviewTable, type SyncJobsOverviewRow } from "@/components/sync-jobs-overview-table";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  COINGECKO_SYNC_JOB_COIN_ID,
  COINGECKO_SYNC_JOB_METRICS,
  type BitvavoSyncJobStatus,
} from "@/lib/markets/record-bitvavo-sync-status";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

export type SyncRunRow = {
  id: string;
  job_key: string;
  status: string;
  trigger_source: string | null;
  created_at: string | null;
  ended_at: string | null;
  reason: string | null;
  /** `automation.sync_runs.metadata` (jsonb); job-specific shape. */
  metadata: Record<string, unknown> | null;
};

const MAX_RUNS = 200;
const RECENT_LIMIT = 40;

const TRACKED_JOB_KEYS = new Set<string>([
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  COINGECKO_SYNC_JOB_METRICS,
  COINGECKO_SYNC_JOB_COIN_ID,
]);

export type SyncRunsOverviewTemplate = Omit<SyncJobsOverviewRow, "status" | "lastStartedAt" | "lastSuccessAt">;

function lastCompletedAtForJob(rows: SyncRunRow[], jobKey: string): string | null {
  for (const r of rows) {
    if (r.job_key === jobKey && r.status === "completed" && r.ended_at) return r.ended_at;
  }
  return null;
}

function sortByCreatedDesc(a: SyncRunRow, b: SyncRunRow): number {
  const ta = a.created_at ?? "";
  const tb = b.created_at ?? "";
  return tb.localeCompare(ta);
}

function metadataFromUnknown(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function rowFromPayload(rec: Record<string, unknown>): SyncRunRow | null {
  const id = rec.id;
  const job_key = rec.job_key;
  if (typeof id !== "string" || typeof job_key !== "string" || !TRACKED_JOB_KEYS.has(job_key)) {
    return null;
  }
  return {
    id,
    job_key,
    status: typeof rec.status === "string" ? rec.status : String(rec.status ?? ""),
    trigger_source: typeof rec.trigger_source === "string" ? rec.trigger_source : (rec.trigger_source as string | null) ?? null,
    created_at: typeof rec.created_at === "string" ? rec.created_at : (rec.created_at as string | null) ?? null,
    ended_at: typeof rec.ended_at === "string" ? rec.ended_at : (rec.ended_at as string | null) ?? null,
    reason:
      typeof rec.reason === "string"
        ? rec.reason
        : typeof rec.failed_reason === "string"
          ? rec.failed_reason
          : null,
    metadata: metadataFromUnknown(rec.metadata),
  };
}

function useClientTick(): { ready: boolean; nowMs: number } {
  const [ready, setReady] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    setReady(true);
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return { ready, nowMs };
}

function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function metadataIsEmpty(m: Record<string, unknown> | null): boolean {
  return m == null || Object.keys(m).length === 0;
}

function MetadataCell({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (metadataIsEmpty(metadata)) {
    return <span className="text-zinc-400">—</span>;
  }
  const compact = JSON.stringify(metadata);
  const title = JSON.stringify(metadata, null, 2);
  const shown = compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
  return (
    <span className="font-mono text-[10px] text-zinc-600 dark:text-zinc-400" title={title}>
      {shown}
    </span>
  );
}

function ElapsedCell({ r, nowMs, ready }: { r: SyncRunRow; nowMs: number; ready: boolean }) {
  const startMs = r.created_at ? Date.parse(r.created_at) : NaN;
  if (!Number.isFinite(startMs)) return <span className="text-zinc-400">—</span>;
  const endedMs = r.ended_at ? Date.parse(r.ended_at) : NaN;
  const endMs = Number.isFinite(endedMs) ? endedMs : ready ? nowMs : NaN;
  if (!Number.isFinite(endMs)) return <span className="text-zinc-400">…</span>;
  const live = r.status === "running" && !r.ended_at;
  return (
    <span className={live ? "text-amber-800 dark:text-amber-300" : undefined} title={live ? "Live (run still open)" : undefined}>
      {formatElapsedMs(endMs - startMs)}
      {live ? <span className="ml-1 text-[9px] font-normal text-zinc-400">live</span> : null}
    </span>
  );
}

function mergeRunIntoList(prev: SyncRunRow[], row: SyncRunRow): SyncRunRow[] {
  const existing = prev.find((r) => r.id === row.id);
  const merged = existing ? ({ ...existing, ...row } as SyncRunRow) : row;
  const without = prev.filter((r) => r.id !== merged.id);
  const next = [merged, ...without];
  next.sort(sortByCreatedDesc);
  return next.slice(0, MAX_RUNS);
}

export function SyncRunsLiveClient({
  initialRuns,
  initialError,
  overviewTemplate,
}: {
  initialRuns: SyncRunRow[];
  initialError: string | null;
  overviewTemplate: SyncRunsOverviewTemplate[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<SyncRunRow[]>(() => [...initialRuns].sort(sortByCreatedDesc));
  const [fetchError, setFetchError] = useState<string | null>(initialError);
  const { ready, nowMs } = useClientTick();

  const overviewRows: SyncJobsOverviewRow[] = useMemo(() => {
    const latestByJob = new Map<string, SyncRunRow>();
    for (const row of runs) {
      if (!latestByJob.has(row.job_key)) latestByJob.set(row.job_key, row);
    }
    return overviewTemplate.map((t) => ({
      ...t,
      status: (latestByJob.get(t.jobKey)?.status as BitvavoSyncJobStatus | null) ?? null,
      lastStartedAt: latestByJob.get(t.jobKey)?.created_at ?? null,
      lastSuccessAt: lastCompletedAtForJob(runs, t.jobKey),
    }));
  }, [runs, overviewTemplate]);

  const recentRuns = useMemo(() => runs.slice(0, RECENT_LIMIT), [runs]);

  const applyPayload = useCallback((rec: Record<string, unknown>) => {
    const row = rowFromPayload(rec);
    if (!row) return;
    setRuns((prev) => mergeRunIntoList(prev, row));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dashboard-sync-runs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "automation", table: "sync_runs" },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            applyPayload(payload.new as Record<string, unknown>);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "automation", table: "sync_runs" },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            applyPayload(payload.new as Record<string, unknown>);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applyPayload]);

  return (
    <>
      <SyncJobsOverviewTable rows={overviewRows} onSyncDone={() => router.refresh()} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent sync runs</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Latest attempts across Bitvavo and CoinGecko jobs (running → completed or failed). Updates live via
          Realtime.
        </p>
        {fetchError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{fetchError}</p>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-2">Job</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Reason</th>
                <th className="py-2 pr-2">Metadata</th>
                <th className="py-2 pr-2">Trigger</th>
                <th className="py-2 pr-2">Started</th>
                <th className="py-2 pr-2">Ended</th>
                <th className="py-2 pr-2">Elapsed</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2 font-mono text-zinc-800 dark:text-zinc-200">{r.job_key}</td>
                  <td className="py-1.5 pr-2">{r.status}</td>
                    <td className="max-w-[200px] truncate py-1.5 pr-2 text-zinc-600 dark:text-zinc-400" title={r.reason ?? ""}>
                      {r.status === "failed" || r.status === "skipped" ? (r.reason ?? "—") : "—"}
                    </td>
                  <td className="max-w-[min(320px,40vw)] truncate py-1.5 pr-2 align-top">
                    <MetadataCell metadata={r.metadata} />
                  </td>
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
                    <ElapsedCell r={r} nowMs={nowMs} ready={ready} />
                  </td>
                </tr>
              ))}
              {!recentRuns.length ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-zinc-500">
                    No runs yet. Use <strong>Sync now</strong> in the table above, or wait for QStash workers.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
