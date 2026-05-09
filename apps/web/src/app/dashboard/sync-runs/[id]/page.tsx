import { SYNC_RUN_DASHBOARD_JOB_KEYS } from "@/lib/dashboard/sync-run-dashboard-jobs";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type SyncRunDetail = {
  id: string;
  job_key: string;
  status: string;
  trigger_source: string | null;
  created_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

export default async function SyncRunDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();

  const { data: row, error } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, ended_at, updated_at, reason, metadata")
    .eq("id", id)
    .in("job_key", [...SYNC_RUN_DASHBOARD_JOB_KEYS])
    .maybeSingle();

  if (error || !row) notFound();

  const run = row as SyncRunDetail;
  const metadataJson =
    run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? JSON.stringify(run.metadata, null, 2)
      : run.metadata == null
        ? "null"
        : JSON.stringify(run.metadata, null, 2);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Sync run</h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">{run.id}</p>
        </div>
        <Link
          href="/dashboard/sync-runs"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← All sync runs
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <dl className="grid gap-3 text-sm sm:grid-cols-[minmax(8rem,10rem)_1fr]">
          <dt className="text-zinc-500">Job</dt>
          <dd className="font-mono text-zinc-900 dark:text-zinc-100">{run.job_key}</dd>

          <dt className="text-zinc-500">Status</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{run.status}</dd>

          <dt className="text-zinc-500">Trigger</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{run.trigger_source ?? "—"}</dd>

          <dt className="text-zinc-500">Started</dt>
          <dd className="font-mono text-zinc-800 dark:text-zinc-200">
            {run.created_at ? new Date(run.created_at).toISOString() : "—"}
          </dd>

          <dt className="text-zinc-500">Ended</dt>
          <dd className="font-mono text-zinc-800 dark:text-zinc-200">
            {run.ended_at ? new Date(run.ended_at).toISOString() : "—"}
          </dd>

          <dt className="text-zinc-500">Updated</dt>
          <dd className="font-mono text-zinc-800 dark:text-zinc-200">
            {run.updated_at ? new Date(run.updated_at).toISOString() : "—"}
          </dd>

          {(run.status === "failed" || run.status === "skipped") && run.reason ? (
            <>
              <dt className="text-zinc-500">Reason</dt>
              <dd className="whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">{run.reason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Metadata</h2>
        <pre className="mt-3 max-h-[min(70vh,32rem)] overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {metadataJson}
        </pre>
      </section>
    </div>
  );
}
