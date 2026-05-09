"use client";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";
import type { BitvavoSyncJobStatus } from "@/lib/markets/record-bitvavo-sync-status";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

function formatAgo(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatIn(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.floor((t - nowMs) / 1000);
  if (sec < 0) return "due now";
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

function formatShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
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

export type SyncJobsOverviewRow = {
  jobKey: string;
  label: string;
  provider: string;
  status: BitvavoSyncJobStatus | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  intervalMs: number;
  action: null | "bitvavo-markets" | "bitvavo-candles" | "coingecko" | "coingecko-coin-id";
  /** Upstash QStash schedule id when this job has a managed recurring schedule; otherwise null. */
  qstashScheduleId: string | null;
};

type QstashListSchedule = {
  scheduleId: string;
  jobKey: string;
  exists: boolean;
  isPaused: boolean | null;
  cron: string | null;
};

type QstashListJson = {
  ok?: boolean;
  tokenConfigured?: boolean;
  schedules?: QstashListSchedule[];
  error?: string;
};

function statusBadge(status: BitvavoSyncJobStatus | null) {
  if (!status) {
    return (
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        no runs
      </span>
    );
  }
  const map = {
    running: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    completed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    skipped: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300",
  } as const;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${map[status]}`}>
      {status}
    </span>
  );
}

function SyncNowCell({
  action,
  onDone,
}: {
  action: SyncJobsOverviewRow["action"];
  onDone: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    },
    [],
  );

  if (!action) {
    return <span className="text-[11px] text-zinc-400">—</span>;
  }

  async function run() {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
    setState("loading");
    setMsg(null);
    try {
      const url =
        action === "bitvavo-markets"
          ? "/api/markets/bitvavo/sync?quote=EUR&source=manual"
          : action === "bitvavo-candles"
            ? "/api/markets/bitvavo/eur-candles-sweep?source=manual"
            : action === "coingecko"
              ? "/api/markets/coingecko/metrics-sync?source=manual"
              : "/api/markets/coingecko/coin-id-sync?source=manual";
      const res = await fetch(url, { method: "POST", credentials: "include" });
      const raw = await res.text();
      let body: {
        error?: string;
        hint?: string;
        upsertedListings?: number;
        assetsUpdated?: number;
        continuationQueued?: boolean;
        stillMissingCoingeckoId?: number;
        copiedFromMetadata?: number;
        filledViaSearch?: number;
        searchAttempts?: number;
        stillMissingCoinId?: number;
        chunksProcessed?: number;
        candleRowsUpserted?: number;
        incomplete?: boolean;
        warning?: string;
      } = {};
      if (raw) {
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          setState("error");
          setMsg(res.ok ? "Invalid JSON response" : raw.slice(0, 120));
          return;
        }
      }
      if (!res.ok) {
        setState("error");
        const hint = body.hint ? ` ${body.hint}` : "";
        setMsg((body.error ?? `HTTP ${res.status}`) + hint);
        return;
      }
      setState("done");
      if (action === "bitvavo-markets") {
        setMsg(`${body.upsertedListings ?? 0} listings`);
      } else if (action === "bitvavo-candles") {
        const tail =
          body.warning != null && String(body.warning).length > 0
            ? ` · ${String(body.warning)}`
            : body.incomplete
              ? " · more queued (QStash) or run again"
              : "";
        setMsg(`chunks ${body.chunksProcessed ?? 0} · ~${body.candleRowsUpserted ?? 0} rows${tail}`);
      } else if (action === "coingecko") {
        const skipped = body.stillMissingCoingeckoId ?? 0;
        const tail =
          skipped > 0 ? ` · ${skipped} skipped (no coingecko_coin_id — use coin-id sync)` : "";
        setMsg(`${body.assetsUpdated ?? 0} assets updated (live CoinGecko)${tail}`);
      } else {
        setMsg(
          `coin id: meta ${body.copiedFromMetadata ?? 0}, search ${body.filledViaSearch ?? 0} (${body.searchAttempts ?? 0} tries) · ${body.stillMissingCoinId ?? "?"} still empty`,
        );
      }
      // Defer refresh so the success/error message stays visible (immediate refresh remounts this cell).
      refreshTimeoutRef.current = globalThis.setTimeout(() => {
        refreshTimeoutRef.current = null;
        onDone();
        setState("idle");
        setMsg(null);
      }, 2200);
    } catch {
      setState("error");
      setMsg("Network error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === "loading"}
        className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {state === "loading" ? "…" : "Sync now"}
      </button>
      {msg ? (
        <span
          className={`max-w-[14rem] text-right text-[10px] leading-snug ${state === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {msg}
        </span>
      ) : null}
    </div>
  );
}

function NextTickCell({ intervalMs, ready, nowMs }: { intervalMs: number; ready: boolean; nowMs: number }) {
  const nextAt =
    ready && intervalMs > 0
      ? new Date(nextLocalWallClockBoundaryAfter(nowMs, intervalMs)).toISOString()
      : null;
  if (intervalMs <= 0) {
    return <span className="text-[11px] text-zinc-400">Manual / external</span>;
  }
  if (!ready || !nextAt) return <span className="text-zinc-400">…</span>;
  return (
    <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
      {formatIn(nextAt, nowMs)}
      <span className="ml-1 font-normal text-zinc-400">({formatShort(nextAt)})</span>
    </span>
  );
}

function QstashScheduleCell({
  row,
  loading,
  fetchError,
  tokenConfigured,
  state,
  actingScheduleId,
  onPauseResume,
}: {
  row: SyncJobsOverviewRow;
  loading: boolean;
  fetchError: string | null;
  tokenConfigured: boolean;
  state: QstashListSchedule | undefined;
  actingScheduleId: string | null;
  onPauseResume: (scheduleId: string, action: "pause" | "resume") => void;
}) {
  if (!row.qstashScheduleId) {
    return <span className="text-[11px] text-zinc-400">—</span>;
  }
  if (loading) {
    return <span className="text-[11px] text-zinc-400">…</span>;
  }
  if (fetchError) {
    return (
      <span className="text-right text-[10px] text-red-600 dark:text-red-400" title={fetchError}>
        QStash: error
      </span>
    );
  }
  if (!tokenConfigured) {
    return <span className="text-right text-[10px] leading-snug text-zinc-500">QStash token not in server env</span>;
  }
  if (!state || !state.exists) {
    return (
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="text-[10px] text-zinc-500">No schedule</span>
        <span className="max-w-[9rem] text-[9px] leading-tight text-zinc-400">Create with pnpm qstash:schedules</span>
      </div>
    );
  }

  const sid = state.scheduleId;
  const busy = actingScheduleId === sid;
  const paused = state.isPaused === true;

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <span
        className={
          paused
            ? "text-[10px] font-medium text-amber-800 dark:text-amber-300"
            : "text-[10px] font-medium text-emerald-800 dark:text-emerald-300"
        }
      >
        {paused ? "Paused" : "Active"}
      </span>
      {state.cron ? (
        <span className="max-w-[10rem] truncate font-mono text-[9px] text-zinc-400" title="QStash cron (UTC)">
          {state.cron}
        </span>
      ) : null}
      {paused ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPauseResume(sid, "resume")}
          className="rounded-md bg-emerald-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-600 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {busy ? "…" : "Resume"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPauseResume(sid, "pause")}
          className="rounded-md border border-amber-800/40 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
        >
          {busy ? "…" : "Pause"}
        </button>
      )}
    </div>
  );
}

export function SyncJobsOverviewTable({
  rows,
  /** Called after a manual “Sync now” request finishes. Defaults to `router.refresh()` when omitted. */
  onSyncDone,
}: {
  rows: SyncJobsOverviewRow[];
  onSyncDone?: () => void;
}) {
  const router = useRouter();
  const { ready, nowMs } = useClientTick();

  const [qstashLoading, setQstashLoading] = useState(true);
  const [qstashFetchErr, setQstashFetchErr] = useState<string | null>(null);
  const [qstashTokenOk, setQstashTokenOk] = useState(false);
  const [qstashByJob, setQstashByJob] = useState<Record<string, QstashListSchedule>>({});
  const [actingScheduleId, setActingScheduleId] = useState<string | null>(null);
  const [pauseResumeErr, setPauseResumeErr] = useState<string | null>(null);

  const fetchQstash = useCallback(async () => {
    setQstashLoading(true);
    setQstashFetchErr(null);
    try {
      const res = await fetch("/api/dashboard/qstash-schedules", { credentials: "include" });
      const raw = await res.text();
      let data: QstashListJson = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as QstashListJson;
        } catch {
          setQstashFetchErr("Invalid JSON from server");
          return;
        }
      }
      if (!res.ok) {
        setQstashFetchErr(typeof data.error === "string" ? data.error : res.statusText);
        return;
      }
      if (data.ok !== true) {
        setQstashFetchErr(typeof data.error === "string" ? data.error : "List failed");
        return;
      }
      setQstashTokenOk(Boolean(data.tokenConfigured));
      const next: Record<string, QstashListSchedule> = {};
      for (const s of data.schedules ?? []) {
        if (typeof s.jobKey === "string" && typeof s.scheduleId === "string") {
          next[s.jobKey] = {
            scheduleId: s.scheduleId,
            jobKey: s.jobKey,
            exists: Boolean(s.exists),
            isPaused: s.isPaused === null || s.isPaused === undefined ? null : Boolean(s.isPaused),
            cron: typeof s.cron === "string" ? s.cron : null,
          };
        }
      }
      setQstashByJob(next);
    } catch {
      setQstashFetchErr("Network error");
    } finally {
      setQstashLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQstash();
  }, [fetchQstash]);

  const afterSync = useCallback(() => {
    if (onSyncDone) onSyncDone();
    else router.refresh();
    void fetchQstash();
  }, [onSyncDone, fetchQstash, router]);

  const handlePauseResume = useCallback(
    (scheduleId: string, action: "pause" | "resume") => {
      setPauseResumeErr(null);
      setActingScheduleId(scheduleId);
      void (async () => {
        try {
          const res = await fetch("/api/dashboard/qstash-schedules", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scheduleId, action }),
          });
          const raw = await res.text();
          let body: { error?: string } = {};
          if (raw) {
            try {
              body = JSON.parse(raw) as { error?: string };
            } catch {
              setPauseResumeErr("Invalid JSON");
              return;
            }
          }
          if (!res.ok) {
            setPauseResumeErr(body.error ?? res.statusText);
            return;
          }
          await fetchQstash();
          router.refresh();
        } catch {
          setPauseResumeErr("Network error");
        } finally {
          setActingScheduleId(null);
        }
      })();
    },
    [fetchQstash, router],
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Scheduled & manual syncs</h2>
        <button
          type="button"
          onClick={() => void fetchQstash()}
          disabled={qstashLoading}
          className="self-start text-[11px] text-zinc-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-zinc-400"
        >
          Refresh QStash status
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        One row per <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">sync_runs</code> job. Status reflects
        the latest attempt; last success is the most recent completed run (by{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">ended_at</code>). CoinGecko only advances when a
        run finishes (QStash worker or <strong>Sync now</strong>). QStash column: Upstash recurring POST
        (UTC cron); EUR catalog also has an hourly schedule plus <strong>Sync now</strong>.
      </p>
      {pauseResumeErr ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {pauseResumeErr}
        </p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">Provider</th>
              <th className="py-2 pr-3 font-medium">Latest</th>
              <th className="py-2 pr-3 font-medium">Last success</th>
              <th className="py-2 pr-3 font-medium">Last started</th>
              <th className="py-2 pr-3 font-medium">Next grid (display)</th>
              <th className="py-2 pr-3 text-right font-medium">QStash</th>
              <th className="py-2 pr-0 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.jobKey} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2.5 pr-3 align-top">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{r.jobKey}</div>
                </td>
                <td className="py-2.5 pr-3 align-top text-zinc-700 dark:text-zinc-300">{r.provider}</td>
                <td className="py-2.5 pr-3 align-top">
                  <div className="flex flex-col gap-1">
                    {statusBadge(r.status)}
                    {r.status === "running" && r.lastStartedAt ? (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">
                        {ready ? formatAgo(r.lastStartedAt, nowMs) : "…"} · {formatShort(r.lastStartedAt)}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="py-2.5 pr-3 align-top font-mono text-zinc-700 dark:text-zinc-300">
                  {r.lastSuccessAt ? (
                    <>
                      {ready ? formatAgo(r.lastSuccessAt, nowMs) : "—"}
                      <div className="mt-0.5 font-normal text-zinc-500">{formatShort(r.lastSuccessAt)}</div>
                    </>
                  ) : (
                    <span className="text-zinc-400">Never</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 align-top font-mono text-zinc-600 dark:text-zinc-400">
                  {r.lastStartedAt ? formatShort(r.lastStartedAt) : "—"}
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <NextTickCell intervalMs={r.intervalMs} ready={ready} nowMs={nowMs} />
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <QstashScheduleCell
                    row={r}
                    loading={qstashLoading}
                    fetchError={qstashFetchErr}
                    tokenConfigured={qstashTokenOk}
                    state={qstashByJob[r.jobKey]}
                    actingScheduleId={actingScheduleId}
                    onPauseResume={handlePauseResume}
                  />
                </td>
                <td className="py-2.5 align-top">
                  <SyncNowCell action={r.action} onDone={afterSync} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
