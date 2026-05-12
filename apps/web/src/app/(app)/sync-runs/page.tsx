import { SyncRunsLiveClient, type SyncRunRow } from "@/components/sync-runs-live-client";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { SYNC_RUN_DASHBOARD_JOB_KEYS } from "@/lib/dashboard/sync-run-dashboard-jobs";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SyncRunsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const localePrefs = await getUserLocalePreferences();

  const jobKeys = [...SYNC_RUN_DASHBOARD_JOB_KEYS];

  const { count: totalRaw, error: countError } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("*", { count: "exact", head: true })
    .in("job_key", jobKeys);

  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: runRows, error: runsError } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, ended_at, reason, metadata")
    .in("job_key", jobKeys)
    .order("created_at", { ascending: false })
    .range(from, to);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];
  const n = runsSafe.length;
  const summaryBits = [
    `${n} on this page`,
    `${totalCount} total`,
    `Page ${page} of ${pages}`,
    "Sorted by Created date",
    "Dashboard-listed jobs only",
    `${pageSize} per page`,
  ];
  if (countError) summaryBits.push(`Count: ${countError.message}`);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="S" />}
        eyebrow="Sync"
        title="Run history"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            All jobs log to <code className="bk-code">sync_runs</code> (append-only). Use the table for status;
            history below updates live while this tab stays open (page 1 only).
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <Link href="/markets" className={listViewOutlineActionClass}>
            Markets
          </Link>
        }
      />

      <ListViewPagination pathname="/sync-runs" page={page} pageSize={pageSize} totalCount={totalCount} />

      <SyncRunsLiveClient
        key={page}
        initialRuns={runsSafe}
        initialError={runsError?.message ?? null}
        localePrefs={localePrefs}
        page={page}
        pageSize={pageSize}
      />

      <ListViewPagination pathname="/sync-runs" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
