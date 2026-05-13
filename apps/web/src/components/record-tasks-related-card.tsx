import { createClient } from "@/lib/supabase/server";
import { RecordPageCard, RecordRelatedList } from "@repo/adricore/blocks";
import Link from "next/link";

export type RecordTasksRelatedCardProps = {
  relatedSchema: string;
  relatedTable: string;
  relatedId: string;
  title?: string;
  limit?: number;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  task_type: string;
  created_at: string;
};

/**
 * Related-list card: open tasks (any status) linked to a catalog/trading/automation record via polymorphic FKs.
 */
export async function RecordTasksRelatedCard({
  relatedSchema,
  relatedTable,
  relatedId,
  title = "Tasks",
  limit = 25,
}: RecordTasksRelatedCardProps) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, task_type, created_at")
    .eq("related_schema", relatedSchema)
    .eq("related_table", relatedTable)
    .eq("related_id", relatedId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as TaskRow[];
  const errMsg = error?.message;

  return (
    <RecordPageCard>
      <RecordRelatedList
        title={title}
        items={rows}
        getKey={(t) => t.id}
        previewLimit={limit}
        emptyMessage="No tasks linked to this record."
        renderRow={(t) => (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
            <Link href={`/tasks/${t.id}`} className="bk-link max-w-[min(100%,20rem)] truncate" title={t.title}>
              {t.title}
            </Link>
            <span className="bk-text-muted shrink-0" style={{ fontSize: "0.75rem" }}>
              <span className="font-mono">{t.status}</span>
              <span> · </span>
              <span className="font-mono">{t.task_type}</span>
            </span>
          </div>
        )}
      />
      {errMsg ? <p className="bk-text-muted mt-2 text-xs">{errMsg}</p> : null}
    </RecordPageCard>
  );
}
