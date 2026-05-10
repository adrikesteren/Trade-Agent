import { UpstashSchedulesListClient } from "@/components/upstash-schedules-list-client";
import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

export default function UpstashSchedulesPage() {
  const summaryBits = [
    "QStash project from server env",
    "Pause / resume via Upstash API",
    "Sorted by name",
  ];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="U" />}
        eyebrow="Upstash"
        title="Schedules"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Recurring HTTP targets registered in your QStash project (<code className="bk-code">QSTASH_TOKEN</code>
            ). Managed Trade Agent schedules are created with{" "}
            <code className="bk-code">pnpm qstash:schedules</code> from <code className="bk-code">apps/web</code>.
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

      <UpstashSchedulesListClient />
    </div>
  );
}
