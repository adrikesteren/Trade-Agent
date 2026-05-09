"use client";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";
import type { BitvavoSyncJobStatus } from "@/lib/markets/record-bitvavo-sync-status";
import { Alert, Badge, Button, Card, CardBody, Table, TableWrap, Td, Th } from "@repo/blocks";
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return { ready: true, nowMs };
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
      <Badge tone="neutral" className="text-[10px]">
        no runs
      </Badge>
    );
  }
  const tone =
    status === "running"
      ? "warning"
      : status === "completed"
        ? "success"
        : status === "failed"
          ? "error"
          : "neutral";
  return (
    <Badge tone={tone} className="text-[10px] capitalize">
      {status}
    </Badge>
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
    return <span className="bk-text-muted text-[11px]">—</span>;
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
      <Button type="button" variant="brand" size="sm" onClick={() => void run()} loading={state === "loading"}>
        Sync now
      </Button>
      {msg ? (
        <span
          className={`max-w-[14rem] text-right text-[10px] leading-snug ${state === "error" ? "" : ""}`}
          style={{
            color: state === "error" ? "var(--bk-color-error)" : "var(--bk-color-success)",
          }}
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
    return <span className="bk-text-muted text-[11px]">Manual / external</span>;
  }
  if (!ready || !nextAt) return <span className="bk-text-muted">…</span>;
  return (
    <span className="bk-text-muted text-[11px]">
      {formatIn(nextAt, nowMs)}
      <span className="ml-1 font-normal opacity-80">({formatShort(nextAt)})</span>
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
    return <span className="bk-text-muted text-[11px]">—</span>;
  }
  if (loading) {
    return <span className="bk-text-muted text-[11px]">…</span>;
  }
  if (fetchError) {
    return (
      <span className="text-right text-[10px]" style={{ color: "var(--bk-color-error)" }} title={fetchError}>
        QStash: error
      </span>
    );
  }
  if (!tokenConfigured) {
    return <span className="bk-text-muted text-right text-[10px] leading-snug">QStash token not in server env</span>;
  }
  if (!state || !state.exists) {
    return (
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="bk-text-muted text-[10px]">No schedule</span>
        <span className="bk-text-muted max-w-[9rem] text-[9px] leading-tight">Create with pnpm qstash:schedules</span>
      </div>
    );
  }

  const sid = state.scheduleId;
  const busy = actingScheduleId === sid;
  const paused = state.isPaused === true;

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <span
        className="text-[10px] font-medium"
        style={{ color: paused ? "var(--bk-color-warning)" : "var(--bk-color-success)" }}
      >
        {paused ? "Paused" : "Active"}
      </span>
      {state.cron ? (
        <span className="bk-text-muted max-w-[10rem] truncate font-mono text-[9px]" title="QStash cron (UTC)">
          {state.cron}
        </span>
      ) : null}
      {paused ? (
        <Button type="button" variant="brand" size="sm" disabled={busy} loading={busy} onClick={() => onPauseResume(sid, "resume")}>
          Resume
        </Button>
      ) : (
        <Button type="button" variant="neutral" size="sm" disabled={busy} loading={busy} onClick={() => onPauseResume(sid, "pause")}>
          Pause
        </Button>
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
    const id = requestAnimationFrame(() => {
      void fetchQstash();
    });
    return () => cancelAnimationFrame(id);
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
    <Card>
      <CardBody>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="bk-form-label" style={{ fontSize: "0.875rem" }}>
            Scheduled & manual syncs
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchQstash()}
            disabled={qstashLoading}
            className="self-start !text-[11px]"
          >
            Refresh QStash status
          </Button>
        </div>
        <p className="bk-text-muted mt-1" style={{ fontSize: "0.75rem" }}>
          One row per <code className="bk-code">sync_runs</code> job. Status reflects the latest attempt; last success
          is the most recent completed run (by <code className="bk-code">ended_at</code>). CoinGecko only advances when
          a run finishes (QStash worker or <strong>Sync now</strong>). QStash column: Upstash recurring POST (UTC
          cron); EUR catalog also has an hourly schedule plus <strong>Sync now</strong>.
        </p>
        {pauseResumeErr ? (
          <Alert tone="error" className="mt-2 !text-xs" role="alert">
            {pauseResumeErr}
          </Alert>
        ) : null}
        <TableWrap className="mt-3">
          <Table className="min-w-[860px] text-left text-[11px]">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Provider</Th>
                <Th>Latest</Th>
                <Th>Last success</Th>
                <Th>Last started</Th>
                <Th>Next grid (display)</Th>
                <Th className="text-right">QStash</Th>
                <Th className="pr-0 text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.jobKey}>
                  <Td className="align-top py-2.5 pr-3">
                    <div className="bk-form-label" style={{ fontWeight: 600, margin: 0 }}>
                      {r.label}
                    </div>
                    <div className="bk-text-muted mt-0.5 font-mono text-[10px]">{r.jobKey}</div>
                  </Td>
                  <Td className="align-top py-2.5 pr-3">{r.provider}</Td>
                  <Td className="align-top py-2.5 pr-3">
                    <div className="flex flex-col gap-1">
                      {statusBadge(r.status)}
                      {r.status === "running" && r.lastStartedAt ? (
                        <span className="text-[10px]" style={{ color: "var(--bk-color-warning)" }}>
                          {ready ? formatAgo(r.lastStartedAt, nowMs) : "…"} · {formatShort(r.lastStartedAt)}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="align-top py-2.5 pr-3 font-mono">
                    {r.lastSuccessAt ? (
                      <>
                        {ready ? formatAgo(r.lastSuccessAt, nowMs) : "—"}
                        <div className="bk-text-muted mt-0.5 font-normal">{formatShort(r.lastSuccessAt)}</div>
                      </>
                    ) : (
                      <span className="bk-text-muted">Never</span>
                    )}
                  </Td>
                  <Td className="bk-text-muted align-top py-2.5 pr-3 font-mono">
                    {r.lastStartedAt ? formatShort(r.lastStartedAt) : "—"}
                  </Td>
                  <Td className="align-top py-2.5 pr-3">
                    <NextTickCell intervalMs={r.intervalMs} ready={ready} nowMs={nowMs} />
                  </Td>
                  <Td className="align-top py-2.5 pr-3">
                    <QstashScheduleCell
                      row={r}
                      loading={qstashLoading}
                      fetchError={qstashFetchErr}
                      tokenConfigured={qstashTokenOk}
                      state={qstashByJob[r.jobKey]}
                      actingScheduleId={actingScheduleId}
                      onPauseResume={handlePauseResume}
                    />
                  </Td>
                  <Td className="align-top py-2.5">
                    <SyncNowCell action={r.action} onDone={afterSync} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </CardBody>
    </Card>
  );
}
