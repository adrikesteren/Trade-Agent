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
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/adricore/blocks";

type FillsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FillsPage({ searchParams }: FillsPageProps) {
  const sp = (await searchParams) ?? {};
  const orderIdFilter = pickSearchParamString(sp, "orderId");
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let countQ = supabase.schema("trading").from("fills").select("*", { count: "exact", head: true });
  if (orderIdFilter) {
    countQ = countQ.eq("order_id", orderIdFilter);
  }
  const { count: totalRaw, error: countError } = await countQ;
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let q = supabase
    .schema("trading")
    .from("fills")
    .select("id, user_id, order_id, price, quantity, fee, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);
  if (orderIdFilter) {
    q = q.eq("order_id", orderIdFilter);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];
  const extraQuery: Record<string, string | undefined> = {};
  if (orderIdFilter) extraQuery.orderId = orderIdFilter;

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        eyebrow="Trading"
        title="Fills"
        iconLetter="F"
        rowCount={list.length}
        sortLine={
          orderIdFilter
            ? `Filtered by order · sorted by created date (newest first) · Page ${page} of ${pages}`
            : `Sorted by created date (newest first) · Page ${page} of ${pages}`
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
