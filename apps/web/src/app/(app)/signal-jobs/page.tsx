import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import * as SignalJobsSelector from "@/lib/selectors/signal-jobs-selector";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@adrikesteren/adricore/blocks";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignalJobsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let totalCount = 0;
  let countError: Error | null = null;
  try {
    totalCount = await SignalJobsSelector.countAll(supabase);
  } catch (e) {
    countError = e instanceof Error ? e : new Error(String(e));
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: Awaited<ReturnType<typeof SignalJobsSelector.selectAllPaginatedOrderedByCreatedAt>> = [];
  let error: Error | null = null;
  try {
    list = await SignalJobsSelector.selectAllPaginatedOrderedByCreatedAt(supabase, { from, to });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("signal_jobs")!}
        rowCount={list.length}
        sortLine={`Sorted by Created date Â· Page ${page} of ${pages} Â· ${totalCount} total${countError ? ` Â· ${countError.message}` : ""}`}
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/signal-jobs" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody>
          <pre className="bk-pre">{JSON.stringify(list, null, 2)}</pre>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/signal-jobs" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
