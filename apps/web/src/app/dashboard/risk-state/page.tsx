import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/blocks";

type RiskStatePageProps = {
  searchParams?: Promise<{ executorId?: string | string[] }>;
};

export default async function RiskStatePage({ searchParams }: RiskStatePageProps) {
  const sp = (await searchParams) ?? {};
  const executorIdFilter = typeof sp.executorId === "string" && sp.executorId.trim() ? sp.executorId.trim() : null;

  const supabase = await createClient();
  let q = supabase
    .schema("trading")
    .from("risk_state")
    .select(
      "id, user_id, executor_id, equity_eur, open_position_count, daily_pnl_eur, max_drawdown_eur, kill_switch, consecutive_losses, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);
  if (executorIdFilter) {
    q = q.eq("executor_id", executorIdFilter);
  }
  const { data: rows, error } = await q;

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Risk State"
        iconLetter="R"
        rowCount={list.length}
        sortLine={
          executorIdFilter ? "Filtered by executor · sorted by Updated date" : "Sorted by Updated date"
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Card>
        <CardBody>
          <pre className="bk-pre">{JSON.stringify(list, null, 2)}</pre>
        </CardBody>
      </Card>
    </div>
  );
}
