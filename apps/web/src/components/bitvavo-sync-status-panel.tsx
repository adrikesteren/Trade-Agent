"use client";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";
import type { BitvavoSyncJobStatus } from "@/lib/markets/record-bitvavo-sync-status";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

/** Same on server and first client paint (avoids hydration mismatch vs toLocaleString). */
function formatIsoUtcShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
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

type SharedSyncRowProps = {
  label: string;
  description: string;
  jobStatus: BitvavoSyncJobStatus | null;
  runStartedAt: string | null;
  completedAt: string | null;
  intervalMs: number;
};

function StatusRunHint({
  jobStatus,
  runStartedAt,
  ready,
  nowMs,
}: {
  jobStatus: BitvavoSyncJobStatus | null;
  runStartedAt: string | null;
  ready: boolean;
  nowMs: number;
}) {
  if (jobStatus === "failed") {
    return (
      <p className="mt-1.5 text-[11px] font-medium text-red-700 dark:text-red-400">
        Status: failed (last successful completion below, if any)
      </p>
    );
  }
  if (jobStatus !== "running" || !runStartedAt) return null;
  return (
    <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      Status: running · started{" "}
      {ready ? formatAgo(runStartedAt, nowMs) : "—"}
      <span className="ml-1 font-normal">
        (
        {ready
          ? new Date(runStartedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
          : "…"}
        )
      </span>
    </p>
  );
}

function CandlesStatusRow({
  label,
  description,
  jobStatus,
  runStartedAt,
  completedAt,
  intervalMs,
  accent,
}: SharedSyncRowProps & { accent: "emerald" | "sky" }) {
  const { ready, nowMs } = useClientTick();

  const nextAt =
    ready && intervalMs > 0
      ? new Date(nextLocalWallClockBoundaryAfter(nowMs, intervalMs)).toISOString()
      : null;

  const dot =
    accent === "emerald"
      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
      : "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]";

  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{label}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
        </div>
        <StatusRunHint jobStatus={jobStatus} runStartedAt={runStartedAt} ready={ready} nowMs={nowMs} />
        <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Last full sweep</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {completedAt ? (
                <>
                  {ready ? formatAgo(completedAt, nowMs) : "—"}
                  <span className="ml-1 font-normal text-zinc-500">
                    (
                    {ready
                      ? new Date(completedAt).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : formatIsoUtcShort(completedAt)}
                    )
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">Never recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Next :00/:05 mark (display only)</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {intervalMs <= 0 ? (
                <span className="font-sans text-zinc-500">Not scheduled — set interval in env to show ETA</span>
              ) : !ready || !nextAt ? (
                <span className="text-zinc-500">…</span>
              ) : (
                <>
                  {formatIn(nextAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    {`(${new Date(nextAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})`}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
          “Last full sweep” updates only after a complete EUR run. Partial runs (timeout / overlap) do not move
          this timestamp. The right column is a fixed wall-clock grid for the interval, not “when the DB will
          update.”
        </p>
      </div>
    </div>
  );
}

function MarketsSyncRow({
  label,
  description,
  jobStatus,
  runStartedAt,
  completedAt,
  intervalMs,
}: SharedSyncRowProps) {
  const router = useRouter();
  const { ready, nowMs } = useClientTick();
  const [btnState, setBtnState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const nextAt =
    ready && intervalMs > 0
      ? new Date(nextLocalWallClockBoundaryAfter(nowMs, intervalMs)).toISOString()
      : null;

  async function onSyncNow() {
    setBtnState("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/markets/bitvavo/sync?quote=EUR&source=manual", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        upsertedListings?: number;
      };
      if (!res.ok) {
        setBtnState("error");
        setMessage(body.error ?? "Sync failed");
        return;
      }
      setBtnState("done");
      setMessage(`Updated ${body.upsertedListings ?? 0} EUR listings. OHLCV follows your candle auto-sync / worker.`);
      router.refresh();
    } catch {
      setBtnState("error");
      setMessage("Network error");
    }
  }

  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{label}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={() => void onSyncNow()}
            disabled={btnState === "loading"}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {btnState === "loading" ? "Syncing…" : "Sync Now"}
          </button>
        </div>
        {message ? (
          <p
            className={`mt-2 text-xs ${btnState === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {message}
          </p>
        ) : null}
        <StatusRunHint jobStatus={jobStatus} runStartedAt={runStartedAt} ready={ready} nowMs={nowMs} />
        <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Last full sweep</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {completedAt ? (
                <>
                  {ready ? formatAgo(completedAt, nowMs) : "—"}
                  <span className="ml-1 font-normal text-zinc-500">
                    (
                    {ready
                      ? new Date(completedAt).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : formatIsoUtcShort(completedAt)}
                    )
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">Never recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Next :00/:05 mark (display only)</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {intervalMs <= 0 ? (
                <span className="font-sans text-zinc-500">Manual only — set interval in env to show ETA</span>
              ) : !ready || !nextAt ? (
                <span className="text-zinc-500">…</span>
              ) : (
                <>
                  {formatIn(nextAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    {`(${new Date(nextAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})`}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export type BitvavoSyncStatusPanelProps = {
  marketsStatus: BitvavoSyncJobStatus | null;
  marketsCreatedAt: string | null;
  marketsCompletedAt: string | null;
  candlesStatus: BitvavoSyncJobStatus | null;
  candlesCreatedAt: string | null;
  candlesCompletedAt: string | null;
  marketsIntervalMs: number;
  candlesIntervalMs: number;
};

export function BitvavoSyncStatusPanel({
  marketsStatus,
  marketsCreatedAt,
  marketsCompletedAt,
  candlesStatus,
  candlesCreatedAt,
  candlesCompletedAt,
  marketsIntervalMs,
  candlesIntervalMs,
}: BitvavoSyncStatusPanelProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sync schedule</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <MarketsSyncRow
          label="Market sync (EUR listings)"
          description="Bitvavo /markets → assets + markets. Manual only — use Sync Now when you want fresh listings."
          jobStatus={marketsStatus}
          runStartedAt={marketsCreatedAt}
          completedAt={marketsCompletedAt}
          intervalMs={marketsIntervalMs}
        />
        <CandlesStatusRow
          label="Candles (full EUR sweep)"
          description="DB: running → completed or failed. On localhost: ENABLE_LOCAL_CANDLE_AUTO_SYNC=1 (restart pnpm dev) runs on the wall-clock grid below."
          jobStatus={candlesStatus}
          runStartedAt={candlesCreatedAt}
          completedAt={candlesCompletedAt}
          intervalMs={candlesIntervalMs}
          accent="sky"
        />
      </div>
    </div>
  );
}
