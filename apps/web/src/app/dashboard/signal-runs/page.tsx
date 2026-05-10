import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody, ListViewObjectIcon } from "@repo/blocks";

export default async function SignalRunsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("automation")
    .from("signal_runs")
    .select("id, signal_job_id, agent_id, signal_id, status, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Automation"
        title="Signal Runs"
        icon={
          <ListViewObjectIcon>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M10 8.5v7l5.25-3.5L10 8.5z" fill="currentColor" />
            </svg>
          </ListViewObjectIcon>
        }
        rowCount={list.length}
        sortLine="Sorted by Started date"
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
