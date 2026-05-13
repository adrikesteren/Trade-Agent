import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody, ListViewObjectIcon } from "@repo/adricore/blocks";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignalRunsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  const { count: totalRaw, error: countError } = await supabase
    .schema("automation")
    .from("signal_runs")
    .select("*", { count: "exact", head: true });
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: rows, error } = await supabase
    .schema("automation")
    .from("signal_runs")
    .select("id, signal_job_id, agent_id, signal_id, status, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .range(from, to);

  const list = rows ?? [];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
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
        sortLine={`Sorted by Started date · Page ${page} of ${pages} · ${totalCount} total${countError ? ` · ${countError.message}` : ""}`}
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
