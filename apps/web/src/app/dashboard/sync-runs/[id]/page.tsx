import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { SYNC_RUN_DASHBOARD_JOB_KEYS } from "@/lib/dashboard/sync-run-dashboard-jobs";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
} from "@repo/blocks";
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
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

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

  const showReason = (run.status === "failed" || run.status === "skipped") && run.reason;

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="S" />}
          eyebrow="Sync run"
          title={run.job_key}
          titleClassName="font-mono"
          highlights={
            <>
              <Output label="Status" type="text" value={run.status} />
              <Output label="Trigger" type="text" value={run.trigger_source ?? "—"} />
            </>
          }
          meta={run.id}
        />
      }
      content={
        <RecordDetailTabs
          details={
            <RecordDetailCard>
              <RecordDetailSection title="Details">
                <RecordDetailGrid>
                  <Output label="Run ID" type="text" value={run.id} span="full" />
                  <Output label="Job" type="text" value={run.job_key} span="full" />
                  <Output label="Status" type="text" value={run.status} />
                  <Output label="Trigger" type="text" value={run.trigger_source ?? "—"} />
                  <Output label="Started" type="datetime" value={run.created_at} formatDatetime={formatDt} />
                  <Output label="Ended" type="datetime" value={run.ended_at} formatDatetime={formatDt} />
                  <Output label="Updated" type="datetime" value={run.updated_at} formatDatetime={formatDt} />
                  {showReason ? <Output label="Reason" type="text" value={run.reason} span="full" /> : null}
                </RecordDetailGrid>
              </RecordDetailSection>

              <RecordDetailSection title="Metadata">
                <pre className="bk-pre">{metadataJson}</pre>
              </RecordDetailSection>
            </RecordDetailCard>
          }
          related={<p className="bk-text-muted text-sm">No related lists for this sync run.</p>}
        />
      }
    />
  );
}
