import { QstashScheduleActiveToggle } from "@/components/qstash-schedule-active-toggle";
import { listQstashSchedules } from "@/lib/qstash/list-schedules";
import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
import type { Schedule } from "@upstash/qstash";
import Link from "next/link";

function formatTs(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  try {
    return new Date(sec * 1000).toISOString();
  } catch {
    return String(sec);
  }
}

function lastStatesSummary(s: Schedule): string {
  const m = s.lastScheduleStates;
  if (!m || typeof m !== "object") return "—";
  const entries = Object.entries(m);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 3)
    .map(([id, st]) => `${st}:${id.slice(0, 8)}…`)
    .join(", ");
}

export default async function SchedulesPage() {
  let schedules: Schedule[] = [];
  let loadError: string | null = null;
  try {
    schedules = await listQstashSchedules();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const n = schedules.length;
  const summaryBits = [
    loadError ? "Could not load schedules" : `${n} schedule${n === 1 ? "" : "s"}`,
    "Pause/resume uses QSTASH_TOKEN on the server",
  ];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="Q" />}
        eyebrow="Automation"
        title="QStash schedules"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            List from the Upstash QStash API; use the Active column toggle to pause or resume a schedule.
            Create or edit destinations and crons in the{" "}
            <a
              href="https://console.upstash.com/qstash"
              className="bk-link"
              target="_blank"
              rel="noreferrer"
            >
              Upstash console
            </a>
            .
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <>
            <Link href="/dashboard/sync-runs" className={listViewOutlineActionClass}>
              Sync runs
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />

      {loadError ? (
        <p className="bk-text-muted text-sm">
          {loadError}. Set <code className="bk-code">QSTASH_TOKEN</code> in <code className="bk-code">.env</code> for
          this machine.
        </p>
      ) : (
        <div className="bk-table-wrap overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="bk-table w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="p-2 font-medium">Schedule ID</th>
                <th className="p-2 font-medium">Cron</th>
                <th className="p-2 font-medium">Destination</th>
                <th className="p-2 font-medium">Method</th>
                <th className="p-2 font-medium">Active</th>
                <th className="p-2 font-medium">Last run</th>
                <th className="p-2 font-medium">Next run</th>
                <th className="p-2 font-medium">Last states</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.scheduleId} className="border-b border-zinc-100 dark:border-zinc-800/80">
                  <td className="p-2 font-mono text-[11px]">{s.scheduleId}</td>
                  <td className="p-2 font-mono">{s.cron}</td>
                  <td className="max-w-[280px] truncate p-2" title={s.destination}>
                    {s.destination}
                  </td>
                  <td className="p-2">{s.method}</td>
                  <td className="p-2 align-middle">
                    <QstashScheduleActiveToggle scheduleId={s.scheduleId} initiallyPaused={s.isPaused} />
                  </td>
                  <td className="p-2 font-mono text-[11px]">{formatTs(s.lastScheduleTime)}</td>
                  <td className="p-2 font-mono text-[11px]">{formatTs(s.nextScheduleTime)}</td>
                  <td className="p-2 text-[11px] text-zinc-600 dark:text-zinc-400">{lastStatesSummary(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
