import { RecordPageTabs } from "@/components/record-page-tabs";
import { RecordTasksRelatedCard } from "@/components/record-tasks-related-card";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
} from "@repo/adricore/blocks";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

export default async function SignalAgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { data: row, error } = await supabase
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, version, description, config, allowed_timeframes, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    notFound();
  }

  const allowed = (row.allowed_timeframes as string[] | null) ?? [];
  const allowedLabel = allowed.length ? allowed.join(", ") : "—";

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        objectRegistry.registrations.get("signal_agents")!.CreateDetailPageHeader({
          record: row as Record<string, unknown>,
          title: row.agent_id,
          highlights: (
            <>
              <Output label="Enabled" type="boolean" value={row.enabled} />
              <Output label="Version" type="text" value={row.version?.trim() ? row.version : "—"} />
            </>
          ),
        })
      }
      sidebar={<RecordTasksRelatedCard relatedSchema="trading" relatedTable="signal_agents" relatedId={id} />}
      content={
        <RecordPageTabs
          details={
            <RecordPageCard>
              <RecordPageSection title="Details">
                <RecordPageGrid>
                  <Output label="Record ID" type="text" value={row.id} span="full" />
                  <Output label="Agent key" type="text" value={row.agent_id} />
                  <Output label="Allowed timeframes" type="text" value={allowedLabel} span="full" />
                  <Output label="Description" type="text" value={row.description?.trim() ? row.description : "—"} span="full" />
                  <Output label="Created" type="datetime" value={row.created_at} formatDatetime={formatDt} />
                  <Output label="Updated" type="datetime" value={row.updated_at} formatDatetime={formatDt} />
                </RecordPageGrid>
              </RecordPageSection>

              <RecordPageSection title="Config (JSON)">
                <Output label="config" type="codeblock" value={JSON.stringify(row.config ?? {}, null, 2)} span="full" />
              </RecordPageSection>
            </RecordPageCard>
          }
        />
      }
    />
  );
}
