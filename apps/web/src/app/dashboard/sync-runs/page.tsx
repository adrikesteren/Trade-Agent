import { SyncRunsLiveClient, type SyncRunRow } from "@/components/sync-runs-live-client";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
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

export default async function SyncRunsPage() {
  const supabase = await createClient();
  const localePrefs = await getUserLocalePreferences();

  const { data: runRows, error: runsError } = await supabase
    .schema("automation")
    .from("sync_runs")
    .select("id, job_key, status, trigger_source, created_at, ended_at, reason, metadata")
    .in("job_key", [...SYNC_RUN_DASHBOARD_JOB_KEYS])
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];
  const n = runsSafe.length;
  const summaryBits = [
    `${n} run${n === 1 ? "" : "s"}`,
    "Sorted by Created date",
    "Dashboard jobs only",
    `Max ${DASHBOARD_LIST_VIEW_LIMIT} rows`,
  ];

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
            history below updates live while this tab stays open.
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <>
            <Link href="/dashboard/markets" className={listViewOutlineActionClass}>
              Markets
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />

      <SyncRunsLiveClient initialRuns={runsSafe} initialError={runsError?.message ?? null} localePrefs={localePrefs} />
    </div>
  );
}
