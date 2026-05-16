"use client";

import { formatDatetime } from "@/lib/locale/format";
import type { UserLocalePreferences } from "@/lib/locale/types";
import { Alert, Card, CardBody, Table, TableWrap, Td, Th } from "@adrikesteren/adricore/blocks";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { SYNC_RUN_DASHBOARD_JOB_KEYS } from "@/lib/dashboard/sync-run-dashboard-jobs";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
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


const TRACKED_JOB_KEYS = new Set<string>(SYNC_RUN_DASHBOARD_JOB_KEYS);

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return { ready: true, nowMs };
}

function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "â€”";
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
    return <span className="bk-text-muted">â€”</span>;
  }
  const compact = JSON.stringify(metadata);
  const title = JSON.stringify(metadata, null, 2);
  const shown = compact.length > 100 ? `${compact.slice(0, 97)}â€¦` : compact;
  return (
    <span className="bk-text-muted font-mono text-[10px]" title={title}>
      {shown}
    </span>
  );
}

function ElapsedCell({ r, nowMs, ready }: { r: SyncRunRow; nowMs: number; ready: boolean }) {
  const startMs = r.created_at ? Date.parse(r.created_at) : NaN;
  if (!Number.isFinite(startMs)) return <span className="bk-text-muted">â€”</span>;
  const endedMs = r.ended_at ? Date.parse(r.ended_at) : NaN;
  const endMs = Number.isFinite(endedMs) ? endedMs : ready ? nowMs : NaN;
  if (!Number.isFinite(endMs)) return <span className="bk-text-muted">â€¦</span>;
  const live = r.status === "running" && !r.ended_at;
  return (
    <span
      suppressHydrationWarning={live}
      style={live ? { color: "var(--bk-color-warning)" } : undefined}
      title={live ? "Live (run still open)" : undefined}
    >
      {formatElapsedMs(endMs - startMs)}
      {live ? <span className="bk-text-muted ml-1 text-[9px] font-normal">live</span> : null}
    </span>
  );
}

function mergeRunIntoList(prev: SyncRunRow[], row: SyncRunRow, pageSize: number): SyncRunRow[] {
  const existing = prev.find((r) => r.id === row.id);
  const merged = existing ? ({ ...existing, ...row } as SyncRunRow) : row;
  const without = prev.filter((r) => r.id !== merged.id);
  const next = [merged, ...without];
  next.sort(sortByCreatedDesc);
  return next.slice(0, pageSize);
}

export function SyncRunsLiveClient({
  initialRuns,
  initialError,
  localePrefs,
  page = 1,
  pageSize = DASHBOARD_LIST_VIEW_LIMIT,
}: {
  initialRuns: SyncRunRow[];
  initialError: string | null;
  localePrefs: UserLocalePreferences;
  page?: number;
  pageSize?: number;
}) {
  const [runs, setRuns] = useState<SyncRunRow[]>(() => [...initialRuns].sort(sortByCreatedDesc));
  const [fetchError] = useState<string | null>(initialError);
  const { ready, nowMs } = useClientTick();

  const formatRunDatetime = useCallback(
    (iso: string | null | undefined) => (iso ? formatDatetime(iso, localePrefs) : "â€”"),
    [localePrefs],
  );

  const recentRuns = useMemo(() => runs, [runs]);

  const applyPayload = useCallback(
    (rec: Record<string, unknown>) => {
      const row = rowFromPayload(rec);
      if (!row) return;
      setRuns((prev) => mergeRunIntoList(prev, row, pageSize));
    },
    [pageSize],
  );

  useEffect(() => {
    if (page !== 1) return;
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
  }, [applyPayload, page]);

  return (
    <>
      <Card>
        <CardBody>
          <h2 className="bk-form-label" style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
            Recent sync runs
          </h2>
          <p className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
            Latest attempts across Bitvavo and CoinGecko jobs (running â†’ completed or failed).
            {page === 1 ? " Updates live via Realtime on this page." : " Open page 1 for live updates."} Open a run via
            the <strong>Job</strong> link.
          </p>
          {fetchError ? (
            <Alert tone="error" className="mt-2 !text-xs">
              {fetchError}
            </Alert>
          ) : null}
          <TableWrap className="mt-3">
            <Table className="text-left text-[11px]">
              <thead>
                <tr>
                  <Th className="py-2 pr-2">Job</Th>
                  <Th className="py-2 pr-2">Status</Th>
                  <Th className="py-2 pr-2">Reason</Th>
                  <Th className="py-2 pr-2">Metadata</Th>
                  <Th className="py-2 pr-2">Trigger</Th>
                  <Th className="py-2 pr-2">Started</Th>
                  <Th className="py-2 pr-2">Ended</Th>
                  <Th className="py-2 pr-2">Elapsed</Th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id}>
                    <Td className="py-1.5 pr-2">
                      <Link
                        href={`/sync-runs/${r.id}`}
                        className="bk-link font-mono"
                        prefetch={false}
                      >
                        {r.job_key}
                      </Link>
                    </Td>
                    <Td className="py-1.5 pr-2">{r.status}</Td>
                    <Td className="max-w-[200px] truncate py-1.5 pr-2 bk-text-muted" title={r.reason ?? ""}>
                      {r.status === "failed" || r.status === "skipped" ? (r.reason ?? "â€”") : "â€”"}
                    </Td>
                    <Td className="max-w-[min(320px,40vw)] truncate py-1.5 pr-2 align-top">
                      <MetadataCell metadata={r.metadata} />
                    </Td>
                    <Td className="py-1.5 pr-2">{r.trigger_source ?? "â€”"}</Td>
                    <Td className="bk-text-muted py-1.5 pr-2 font-mono">{formatRunDatetime(r.created_at)}</Td>
                    <Td className="bk-text-muted py-1.5 pr-2 font-mono">{formatRunDatetime(r.ended_at)}</Td>
                    <Td className="bk-text-muted py-1.5 pr-2 font-mono">
                      <ElapsedCell r={r} nowMs={nowMs} ready={ready} />
                    </Td>
                  </tr>
                ))}
                {!recentRuns.length ? (
                  <tr>
                    <Td colSpan={8} muted className="py-6 text-center">
                      No runs yet. Scheduled workers will append rows here when they run.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </>
  );
}
