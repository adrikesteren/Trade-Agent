import * as TasksSelector from "@/lib/selectors/tasks-selector";
import { createClient } from "@/lib/supabase/server";
import { ListViewObjectIcon, RecordRelatedList } from "@adrikesteren/adricore/blocks";
import Link from "next/link";

export type RecordTasksRelatedCardProps = {
  relatedSchema: string;
  relatedTable: string;
  relatedId: string;
  title?: string;
  limit?: number;
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
  let rows: Awaited<ReturnType<typeof TasksSelector.selectRootsForRelatedRecord>> = [];
  let errMsg: string | undefined;
  try {
    rows = await TasksSelector.selectRootsForRelatedRecord(supabase, {
      relatedSchema,
      relatedTable,
      relatedId,
      limit,
    });
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="bk-stack bk-stack_gap-sm">
      <RecordRelatedList
        title={title}
        icon={<ListViewObjectIcon letter="T" />}
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
              <span> Â· </span>
              <span className="font-mono">{t.task_type}</span>
            </span>
          </div>
        )}
      />
      {errMsg ? <p className="bk-text-muted text-xs">{errMsg}</p> : null}
    </div>
  );
}
