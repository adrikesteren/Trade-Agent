"use client";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";
import type { BitvavoSyncJobStatus } from "@/lib/markets/record-bitvavo-sync-status";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  action: null | "bitvavo-markets" | "coingecko" | "coingecko-coin-id";
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
      } else if (action === "coingecko") {
        const tail = body.continuationQueued
          ? ` · catalog resolve continues (${body.stillMissingCoingeckoId ?? "?"} left)`
          : (body.stillMissingCoingeckoId ?? 0) > 0
            ? ` · ${body.stillMissingCoingeckoId} assets still without CoinGecko id (enable QStash + public URL to finish)`
            : "";
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

export function SyncJobsOverviewTable({ rows }: { rows: SyncJobsOverviewRow[] }) {
  const router = useRouter();
  const { ready, nowMs } = useClientTick();

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Scheduled & manual syncs</h2>
      <p className="mt-1 text-xs text-zinc-500">
        One row per <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">sync_runs</code> job. Status reflects
        the latest attempt; last success is the most recent completed run. CoinGecko only advanced when a run
        finishes (worker, local dev timer, or <strong>Sync now</strong>).
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">Provider</th>
              <th className="py-2 pr-3 font-medium">Latest</th>
              <th className="py-2 pr-3 font-medium">Last success</th>
              <th className="py-2 pr-3 font-medium">Last started</th>
              <th className="py-2 pr-3 font-medium">Next grid (display)</th>
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
                <td className="py-2.5 align-top">
                  <SyncNowCell action={r.action} onDone={() => router.refresh()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
