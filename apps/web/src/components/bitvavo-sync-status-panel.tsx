"use client";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";
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

type RowProps = {
  label: string;
  description: string;
  lastSuccessAt: string | null;
  intervalMs: number;
  accent: "emerald" | "sky";
};

function CandlesStatusRow({ label, description, lastSuccessAt, intervalMs, accent }: RowProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextAt =
    intervalMs > 0 ? new Date(nextLocalWallClockBoundaryAfter(nowMs, intervalMs)).toISOString() : null;

  const dot =
    accent === "emerald"
      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
      : "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]";

  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{label}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
        <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Last sync</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {lastSuccessAt ? (
                <>
                  {formatAgo(lastSuccessAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    ({new Date(lastSuccessAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">Never recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Next sync (local wall clock)</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {intervalMs <= 0 ? (
                <span className="font-sans text-zinc-500">Not scheduled — set interval in env to show ETA</span>
              ) : (
                <>
                  {formatIn(nextAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    {`(${new Date(nextAt!).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})`}
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

function MarketsSyncRow({
  label,
  description,
  lastSuccessAt,
  intervalMs,
}: Omit<RowProps, "accent">) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextAt =
    intervalMs > 0 ? new Date(nextLocalWallClockBoundaryAfter(nowMs, intervalMs)).toISOString() : null;

  async function onSyncNow() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/markets/bitvavo/sync?quote=EUR&source=manual", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        upsertedListings?: number;
        candlesBackfill?: {
          error?: string;
          seededMarkets?: number;
          candleRowsUpserted?: number;
          missingTotal?: number;
        } | null;
      };
      if (!res.ok) {
        setStatus("error");
        setMessage(body.error ?? "Sync failed");
        return;
      }
      setStatus("done");
      const bf = body.candlesBackfill;
      let extra = "";
      if (bf && !bf.error && (bf.seededMarkets ?? 0) > 0) {
        const remaining = Math.max(0, (bf.missingTotal ?? 0) - (bf.seededMarkets ?? 0));
        extra = ` · OHLCV: ${bf.seededMarkets} new market(s), ${bf.candleRowsUpserted ?? 0} rows (5m)`;
        if (remaining > 0) extra += `; ${remaining} still need candles — run Sync Now again`;
      } else if (bf?.error) {
        extra = ` · OHLCV backfill: ${bf.error}`;
      }
      setMessage(`Updated ${body.upsertedListings ?? 0} EUR listings.${extra}`);
      router.refresh();
    } catch {
      setStatus("error");
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
            disabled={status === "loading"}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {status === "loading" ? "Syncing…" : "Sync Now"}
          </button>
        </div>
        {message ? (
          <p
            className={`mt-2 text-xs ${status === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {message}
          </p>
        ) : null}
        <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Last sync</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {lastSuccessAt ? (
                <>
                  {formatAgo(lastSuccessAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    ({new Date(lastSuccessAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">Never recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Next sync (local wall clock)</dt>
            <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
              {intervalMs <= 0 ? (
                <span className="font-sans text-zinc-500">Manual only — set interval in env to show ETA</span>
              ) : (
                <>
                  {formatIn(nextAt, nowMs)}
                  <span className="ml-1 font-normal text-zinc-500">
                    {`(${new Date(nextAt!).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })})`}
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
  marketsLastSuccessAt: string | null;
  candlesLastSuccessAt: string | null;
  marketsIntervalMs: number;
  candlesIntervalMs: number;
};

export function BitvavoSyncStatusPanel({
  marketsLastSuccessAt,
  candlesLastSuccessAt,
  marketsIntervalMs,
  candlesIntervalMs,
}: BitvavoSyncStatusPanelProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sync schedule</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <MarketsSyncRow
          label="Market sync (EUR listings)"
          description="Bitvavo /markets → assets + markets. Use Sync Now on demand; otherwise your scheduled job."
          lastSuccessAt={marketsLastSuccessAt}
          intervalMs={marketsIntervalMs}
        />
        <CandlesStatusRow
          label="Candles (full EUR sweep)"
          description="Last sync updates only after a full EUR sweep from the worker route (QStash-signed POST or Bearer CRON_SECRET). Vercel Cron GET can enqueue the sweep when APP_BASE_URL and QSTASH_TOKEN are set — see .env.example."
          lastSuccessAt={candlesLastSuccessAt}
          intervalMs={candlesIntervalMs}
          accent="sky"
        />
      </div>
    </div>
  );
}
