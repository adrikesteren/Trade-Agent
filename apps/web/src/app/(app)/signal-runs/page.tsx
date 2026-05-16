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
import * as SignalRunsSelector from "@/lib/selectors/signal-runs-selector";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody, ListViewObjectIcon } from "@adrikesteren/adricore/blocks";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignalRunsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let totalCount = 0;
  let countError: Error | null = null;
  try {
    totalCount = await SignalRunsSelector.countAll(supabase);
  } catch (e) {
    countError = e instanceof Error ? e : new Error(String(e));
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: Awaited<ReturnType<typeof SignalRunsSelector.selectAllPaginatedOrderedByStartedAt>> = [];
  let error: Error | null = null;
  try {
    list = await SignalRunsSelector.selectAllPaginatedOrderedByStartedAt(supabase, { from, to });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("signal_runs")!}
        icon={
          <ListViewObjectIcon>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M10 8.5v7l5.25-3.5L10 8.5z" fill="currentColor" />
            </svg>
          </ListViewObjectIcon>
        }
        rowCount={list.length}
        sortLine={`Sorted by Started date Â· Page ${page} of ${pages} Â· ${totalCount} total${countError ? ` Â· ${countError.message}` : ""}`}
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/signal-runs" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody>
          <pre className="bk-pre">{JSON.stringify(list, null, 2)}</pre>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/signal-runs" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
