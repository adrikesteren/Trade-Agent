import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { TaskDetailHeaderActions } from "@/app/(app)/tasks/[id]/task-detail-header-actions";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { resolveRelatedHref } from "@/lib/tasks/resolve-related-href";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
  RecordRelatedList,
} from "@repo/adricore/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type TaskDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  due_at: string | null;
  related_schema: string;
  related_table: string;
  related_id: string;
  parent_task_id: string | null;
  task_type: string;
  job_identifier: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function metadataJson(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== "object") return "{}";
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return "{}";
  }
}

export default async function TaskDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null | undefined) =>
    v == null ? "—" : formatDatetime(v, prefs);

  const { data: task, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, due_at, related_schema, related_table, related_id, parent_task_id, task_type, job_identifier, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !task) notFound();

  const t = task as TaskDetail;
  const relatedHref = resolveRelatedHref(t.related_schema, t.related_table, t.related_id);

  let parentTitle: string | null = null;
  if (t.parent_task_id) {
    const { data: p } = await supabase.from("tasks").select("title").eq("id", t.parent_task_id).maybeSingle();
    parentTitle = (p as { title?: string } | null)?.title ?? null;
  }

  const { data: subRows } = await supabase
    .from("tasks")
    .select("id, title, status, task_type, created_at")
    .eq("parent_task_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const subtasks = (subRows ?? []) as { id: string; title: string; status: string; task_type: string; created_at: string }[];

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="T" />}
          eyebrow="Task"
          title={t.title}
          highlights={
            <>
              <Output label="Status" type="text" value={<span className="font-mono">{t.status}</span>} />
              <Output label="Type" type="text" value={<span className="font-mono">{t.task_type}</span>} />
            </>
          }
          meta={t.id}
          actions={
            <TaskDetailHeaderActions
              taskId={t.id}
              initialTitle={t.title}
              initialDescription={t.description ?? ""}
              initialPriority={t.priority ?? ""}
              initialDueAtIso={t.due_at}
              initialStatus={t.status}
              subtaskCount={subtasks.length}
              subtasksHref={`/tasks/${id}/tasks`}
            />
          }
        />
      }
      content={
        <RecordDetailTabs
          details={
            <div className="bk-stack bk-stack_gap-md">
              <RecordDetailCard>
                <RecordDetailSection title="Details">
                  <RecordDetailGrid>
                    <Output label="Task ID" type="text" value={t.id} span="full" />
                    <Output label="Title" type="text" value={t.title} span="full" />
                    <Output label="Description" type="text" value={t.description?.trim() ? t.description : "—"} span="full" />
                    <Output label="Priority" type="text" value={t.priority?.trim() ? t.priority : "—"} />
                    <Output label="Due" type="text" value={t.due_at ? formatDt(t.due_at) : "—"} />
                    <Output label="Job id" type="text" value={t.job_identifier?.trim() ? t.job_identifier : "—"} />
                    <Output
                      label="Related record"
                      type="text"
                      value={
                        relatedHref ? (
                          <Link href={relatedHref} className="bk-link font-mono">
                            {t.related_schema}.{t.related_table} → open
                          </Link>
                        ) : (
                          <span className="bk-text-muted font-mono text-xs">
                            {t.related_schema}.{t.related_table} ({t.related_id})
                          </span>
                        )
                      }
                      span="full"
                    />
                    {t.parent_task_id ? (
                      <Output
                        label="Parent task"
                        type="text"
                        value={
                          <Link href={`/tasks/${t.parent_task_id}`} className="bk-link font-mono">
                            {parentTitle ?? t.parent_task_id.slice(0, 8) + "…"}
                          </Link>
                        }
                        span="full"
                      />
                    ) : null}
                    <Output label="Created" type="datetime" value={t.created_at} formatDatetime={formatDt} />
                    <Output label="Updated" type="datetime" value={t.updated_at} formatDatetime={formatDt} />
                    <Output label="Metadata" type="codeblock" value={metadataJson(t.metadata)} span="full" />
                  </RecordDetailGrid>
                </RecordDetailSection>
              </RecordDetailCard>
            </div>
          }
        />
      }
      sidebar={
        <div className="bk-stack bk-stack_gap-md">
          <RecordDetailCard>
            <RecordRelatedList
              title="Subtasks"
              description="Child tasks with parent_task_id pointing at this record."
              items={subtasks}
              getKey={(s) => s.id}
              previewLimit={15}
              totalCount={subtasks.length}
              viewAllHref={subtasks.length > 0 ? `/tasks/${id}/tasks` : undefined}
              emptyMessage="No subtasks for this task."
              renderRow={(s) => (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                  <Link href={`/tasks/${s.id}`} className="bk-link max-w-[min(100%,20rem)] truncate" title={s.title}>
                    {s.title}
                  </Link>
                  <span className="bk-text-muted shrink-0 font-mono text-xs">
                    {s.status} · {s.task_type}
                  </span>
                </div>
              )}
            />
          </RecordDetailCard>
        </div>
      }
    />
  );
}
