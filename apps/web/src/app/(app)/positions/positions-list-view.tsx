import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert, Card, CardBody, ListViewLayout, listViewOutlineActionClass } from "@adrikesteren/adricore/blocks";
import Link from "next/link";

const CHUNK = 120;

async function fetchExecutorNamesById(
  supabase: SupabaseClient,
  executorIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!executorIds.length) return map;
  const unique = [...new Set(executorIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.schema("trading").from("executors").select("id, name").in("id", chunk);
    if (error) {
      console.error("positions list: executors batch:", error.message);
      continue;
    }
    for (const e of data ?? []) {
      map.set(e.id as string, String(e.name ?? "").trim() || (e.id as string));
    }
  }
  return map;
}

export type PositionsListViewProps = {
  executorIdFilter: string | null;
  parentExecutor?: { id: string; name: string };
  paginationPathname: string;
  page: number;
};

export async function PositionsListView({
  executorIdFilter,
  parentExecutor,
  paginationPathname,
  page: pageRaw,
}: PositionsListViewProps) {
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let countQ = supabase.schema("trading").from("positions").select("*", { count: "exact", head: true });
  if (executorIdFilter) {
    countQ = countQ.eq("executor_id", executorIdFilter);
  }
  const { count: totalRaw, error: countError } = await countQ;
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let q = supabase
    .schema("trading")
    .from("positions")
    .select("id, user_id, executor_id, market_id, position_side, quantity, avg_price, paper, updated_at")
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (executorIdFilter) {
    q = q.eq("executor_id", executorIdFilter);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];
  const executorIds = [...new Set((list as { executor_id?: string }[]).map((r) => r.executor_id).filter(Boolean))] as string[];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          model={objectRegistry.registrations.get("positions")!}
          title={parentExecutor ? `Positions Â· ${parentExecutor.name}` : undefined}
          rowCount={list.length}
          sortLine={
            executorIdFilter
              ? `Filtered by executor Â· sorted by updated date (newest first) Â· Page ${page} of ${pages} Â· ${totalCount} total`
              : `Sorted by updated date (newest first) Â· Page ${page} of ${pages} Â· ${totalCount} total`
          }
          actions={
            parentExecutor ? (
              <Link href={`/executors/${parentExecutor.id}`} className={listViewOutlineActionClass}>
                Executor
              </Link>
            ) : undefined
          }
        />
        {error ? <Alert tone="error">{error.message}</Alert> : null}
        {countError ? <Alert tone="error">{countError.message}</Alert> : null}

        <ListViewPagination
          pathname={paginationPathname}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          extraQuery={extraQuery}
        />

        <Card>
          <CardBody>
            <pre className="bk-pre">
              {JSON.stringify(
                list.map((r) => {
                  const row = r as Record<string, unknown>;
                  const eid = String(row.executor_id ?? "");
                  return { ...row, executor_name: eid ? executorNameById.get(eid) ?? eid : null };
                }),
                null,
                2,
              )}
            </pre>
          </CardBody>
        </Card>

        <ListViewPagination
          pathname={paginationPathname}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          extraQuery={extraQuery}
        />
      </div>
    </ListViewLayout>
  );
}
