import { createClient } from "@/lib/supabase/server";
import {
  Breadcrumbs,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailLayout,
  RecordDetailSection,
} from "@repo/blocks";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ signalAgentId: string }> };

export default async function SignalAgentDetailPage({ params }: PageProps) {
  const { signalAgentId } = await params;
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .schema("trading")
    .from("signal_agents")
    .select("id, agent_id, enabled, version, description, config, allowed_timeframes, created_at, updated_at")
    .eq("id", signalAgentId)
    .maybeSingle();

  if (error || !row) {
    notFound();
  }

  const allowed = (row.allowed_timeframes as string[] | null) ?? [];
  const allowedLabel = allowed.length ? allowed.join(", ") : "—";

  return (
    <RecordDetailLayout className="bk-container bk-stack bk-stack_gap-md px-1" style={{ maxWidth: "48rem" }}>
      <PageHeader
        variant="detail"
        icon={<ListViewObjectIcon letter="A" />}
        breadcrumb={
          <Breadcrumbs
            items={[{ label: "Signal agents", href: "/dashboard/signal-agents" }, { label: "Detail" }]}
          />
        }
        back={{ href: "/dashboard/signal-agents", label: "← All signal agents" }}
        eyebrow="Signal agent"
        title={row.agent_id}
        highlights={
          <>
            <Output label="Enabled" type="boolean" value={row.enabled} />
            <Output label="Version" type="text" value={row.version?.trim() ? row.version : "—"} />
          </>
        }
        meta={`id: ${row.id}`}
      />

      <RecordDetailCard>
        <RecordDetailSection title="Details">
          <RecordDetailGrid>
            <Output label="Record ID" type="text" value={row.id} span="full" />
            <Output label="Agent key" type="text" value={row.agent_id} />
            <Output label="Allowed timeframes" type="text" value={allowedLabel} span="full" />
            <Output label="Description" type="text" value={row.description?.trim() ? row.description : "—"} span="full" />
            <Output label="Created" type="datetime" value={row.created_at} />
            <Output label="Updated" type="datetime" value={row.updated_at} />
          </RecordDetailGrid>
        </RecordDetailSection>

        <RecordDetailSection title="Config (JSON)">
          <Output label="config" type="codeblock" value={JSON.stringify(row.config ?? {}, null, 2)} span="full" />
        </RecordDetailSection>
      </RecordDetailCard>
    </RecordDetailLayout>
  );
}
