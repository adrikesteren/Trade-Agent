import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  pickSearchParamString,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import * as FillsSelector from "@/lib/selectors/fills-selector";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@adrikesteren/adricore/blocks";

type FillsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FillsPage({ searchParams }: FillsPageProps) {
  const sp = (await searchParams) ?? {};
  const orderIdFilter = pickSearchParamString(sp, "orderId");
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let totalCount = 0;
  let countError: { message: string } | null = null;
  try {
    totalCount = await FillsSelector.countAll(supabase, { orderIdFilter });
  } catch (e) {
    countError = { message: e instanceof Error ? e.message : String(e) };
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: Awaited<ReturnType<typeof FillsSelector.selectListPaginated>> = [];
  let error: { message: string } | null = null;
  try {
    list = await FillsSelector.selectListPaginated(supabase, { from, to, orderIdFilter });
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }
  const extraQuery: Record<string, string | undefined> = {};
  if (orderIdFilter) extraQuery.orderId = orderIdFilter;

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("fills")!}
        rowCount={list.length}
        sortLine={
          orderIdFilter
            ? `Filtered by order Â· sorted by created date (newest first) Â· Page ${page} of ${pages}`
            : `Sorted by created date (newest first) Â· Page ${page} of ${pages}`
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {countError ? <Alert tone="error">{countError.message}</Alert> : null}

      <ListViewPagination
        pathname="/fills"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        extraQuery={extraQuery}
      />

      <Card>
        <CardBody>
          <pre className="bk-pre">{JSON.stringify(list, null, 2)}</pre>
        </CardBody>
      </Card>

      <ListViewPagination
        pathname="/fills"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        extraQuery={extraQuery}
      />
    </div>
  );
}
