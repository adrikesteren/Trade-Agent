import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody } from "@repo/blocks";

export default async function SignalJobsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("automation")
    .from("signal_jobs")
    .select("id, job_key, market_id, timeframe, close_time, status, error, created_at, started_at, ended_at")
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Automation"
        title="Signal Jobs"
        iconLetter="J"
        rowCount={list.length}
        sortLine="Sorted by Created date"
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
