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
import { redirect } from "next/navigation";

type RiskStatePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RiskStatePage({ searchParams }: RiskStatePageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = pickSearchParamString(sp, "executorId");
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let countQ = supabase
    .schema("trading")
    .from("executors")
    .select("*", { count: "exact", head: true });
  if (executorIdFilter) {
    countQ = countQ.eq("id", executorIdFilter).eq("user_id", user.id);
  } else {
    countQ = countQ.eq("user_id", user.id);
  }
  const { count: totalRaw, error: countError } = await countQ;
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let q = supabase
    .schema("trading")
    .from("executors")
    .select(
      "id, user_id, name, updated_at, risk_open_position_count, risk_exposure_by_market, risk_daily_pnl_eur, risk_runtime_max_drawdown_eur, risk_kill_switch, risk_consecutive_losses",
    )
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (executorIdFilter) {
    q = q.eq("id", executorIdFilter).eq("user_id", user.id);
  } else {
    q = q.eq("user_id", user.id);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];
  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        eyebrow="Trading"
        title="Executor runtime risk"
        iconLetter="R"
        rowCount={list.length}
        sortLine={
          executorIdFilter
            ? `Filtered by executor · sorted by Updated date · Page ${page} of ${pages}`
            : `Sorted by Updated date · Page ${page} of ${pages}`
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {countError ? <Alert tone="error">{countError.message}</Alert> : null}

      <ListViewPagination
        pathname="/risk-state"
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
        pathname="/risk-state"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        extraQuery={extraQuery}
      />
    </div>
  );
}
