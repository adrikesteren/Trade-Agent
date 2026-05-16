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
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@adrikesteren/adricore/blocks";
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

  let totalCount = 0;
  let countError: { message: string } | null = null;
  try {
    totalCount = executorIdFilter
      ? await ExecutorsSelector.countRiskStateForUserAndId(supabase, {
          userId: user.id,
          id: executorIdFilter,
        })
      : await ExecutorsSelector.countRiskStateForUser(supabase, user.id);
  } catch (e) {
    countError = { message: e instanceof Error ? e.message : String(e) };
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let rows: ExecutorsSelector.ExecutorRiskStateRow[] = [];
  let error: { message: string } | null = null;
  try {
    rows = executorIdFilter
      ? await ExecutorsSelector.selectRiskStatePaginatedForUserAndId(supabase, {
          userId: user.id,
          id: executorIdFilter,
          from,
          to,
        })
      : await ExecutorsSelector.selectRiskStatePaginatedForUser(supabase, {
          userId: user.id,
          from,
          to,
        });
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  const list = rows;
  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("risk_state")!}
        title="Executor runtime risk"
        rowCount={list.length}
        sortLine={
          executorIdFilter
            ? `Filtered by executor Â· sorted by Updated date Â· Page ${page} of ${pages}`
            : `Sorted by Updated date Â· Page ${page} of ${pages}`
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
