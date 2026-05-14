import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import {
  buildTaskListStatusSelectOptions,
  normalizeDashboardTaskRootStatusesRpcResult,
  parseTaskListStatusFilter,
  taskListStatusExtraQuery,
  taskListStatusSortLine,
} from "@/lib/tasks/task-list-status";
import { TasksListStatusFilter } from "@/app/(app)/tasks/tasks-list-status-filter";
import {
  Alert,
  Card,
  CardBody,
  ListViewLayout,
  ListViewPlaceholderToolbar,
  Table,
  TableWrap,
  Td,
  Th,
} from "@repo/adricore/blocks";
import Link from "next/link";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  task_type: string;
  related_schema: string;
  related_table: string;
  related_id: string;
  created_at: string;
};

export default async function TasksListPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const filter = parseTaskListStatusFilter(sp);
  const extraQuery = taskListStatusExtraQuery(filter);

  const { data: rpcStatuses, error: rpcErr } = await supabase.rpc("dashboard_task_root_statuses");
  const distinctFromDb = rpcErr ? [] : normalizeDashboardTaskRootStatusesRpcResult(rpcStatuses);
  const statusOptionSource =
    filter.mode === "eq" ? [...distinctFromDb, filter.status] : distinctFromDb;
  const statusOptions = buildTaskListStatusSelectOptions(statusOptionSource);

  let countQ = supabase.from("tasks").select("*", { count: "exact", head: true }).is("parent_task_id", null);
  if (filter.mode === "eq") {
    countQ = countQ.eq("status", filter.status);
  }

  const { count: totalRaw, error: countError } = await countQ;

  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let rowsQ = supabase
    .from("tasks")
    .select("id, title, status, task_type, related_schema, related_table, related_id, created_at")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (filter.mode === "eq") {
    rowsQ = rowsQ.eq("status", filter.status);
  }

  const { data: rows, error } = await rowsQ;

  const list = (rows ?? []) as TaskRow[];

  return (
    <ListViewLayout className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("tasks")!}
        rowCount={totalCount}
        sortLine={taskListStatusSortLine(filter)}
        uncapped
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <TasksListStatusFilter statusOptions={statusOptions} filter={filter} />
            <ListViewPlaceholderToolbar />
          </div>
        }
      />

      {rpcErr ? (
        <Alert tone="warning">
          Could not load status list ({rpcErr.message}). Filters still work for known statuses; run pending
          migrations if this persists.
        </Alert>
      ) : null}
      {countError ? <Alert tone="error">{countError.message}</Alert> : null}
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Type</Th>
                  <Th>Related</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link href={`/tasks/${t.id}`} className="bk-link font-medium">
                        {t.title}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{t.status}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{t.task_type}</span>
                    </Td>
                    <Td>
                      <span className="bk-text-muted font-mono text-xs">
                        {t.related_schema}.{t.related_table}
                      </span>
                      <div className="font-mono text-[0.7rem] text-neutral-500">{t.related_id}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDt(t.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/tasks" page={page} pageSize={pageSize} totalCount={totalCount} extraQuery={extraQuery} />
    </ListViewLayout>
  );
}
