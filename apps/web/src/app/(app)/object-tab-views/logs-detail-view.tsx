import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
} from "@repo/adricore/blocks";
import { notFound } from "next/navigation";

type LogDetail = {
  id: string;
  user_id: string;
  level: string;
  message: string;
  context: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

type LogsDetailViewProps = { recordId: string };

/** Log detail — used by `(app)/[tabSlug]/[recordId]` when `tabSlug` is `logs`. */
export async function LogsDetailView({ recordId }: LogsDetailViewProps) {
  const id = recordId;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { data: row, error } = await supabase
    .from("logs")
    .select("id, user_id, level, message, context, metadata, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) notFound();

  const log = row as LogDetail;
  const metadataJson =
    log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
      ? JSON.stringify(log.metadata, null, 2)
      : log.metadata == null
        ? "null"
        : JSON.stringify(log.metadata, null, 2);

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="L" />}
          eyebrow="Log"
          title={log.level}
          titleClassName="font-mono"
          highlights={
            <>
              <Output label="Created" type="datetime" value={log.created_at} formatDatetime={formatDt} />
              <Output label="Context" type="text" value={log.context ?? "—"} />
            </>
          }
          subtitle={log.message}
          meta={log.id}
        />
      }
      content={
        <RecordDetailTabs
          details={
            <RecordDetailCard>
              <RecordDetailSection title="Details">
                <RecordDetailGrid>
                  <Output label="Log ID" type="text" value={log.id} span="full" />
                  <Output label="User ID" type="text" value={log.user_id} span="full" />
                  <Output label="Level" type="text" value={log.level} />
                  <Output label="Context" type="text" value={log.context ?? "—"} />
                  <Output label="Created" type="datetime" value={log.created_at} formatDatetime={formatDt} />
                  <Output label="Message" type="text" value={log.message} span="full" />
                </RecordDetailGrid>
              </RecordDetailSection>

              <RecordDetailSection title="Metadata">
                <pre className="bk-pre">{metadataJson}</pre>
              </RecordDetailSection>
            </RecordDetailCard>
          }
        />
      }
    />
  );
}
