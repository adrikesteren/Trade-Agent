import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
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
} from "@repo/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type SignalDetail = {
  id: string;
  signal_agent_id: string;
  market_id: string;
  timeframe: string;
  close_time: string;
  intent: string;
  confidence: number | string | null;
  reasons: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function agentSlugFromRow(row: SignalDetail): string | null {
  const rel = row.signal_agents;
  if (!rel) return null;
  const first = Array.isArray(rel) ? rel[0] : rel;
  return first?.agent_id ?? null;
}

function intentClass(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT") return "font-medium text-red-700 dark:text-red-400";
  if (intent === "HOLD") return "bk-text-muted";
  return "";
}

function reasonsJson(reasons: unknown): string {
  try {
    return JSON.stringify(reasons ?? [], null, 2);
  } catch {
    return "[]";
  }
}

export default async function SignalDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null | undefined) =>
    v == null ? "—" : formatDatetime(v, prefs);
  const fmtConfidence = (v: number | string | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: sigRow, error: sigErr } = await supabase
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, market_id, timeframe, close_time, intent, confidence, reasons, metadata, created_at, signal_agents ( agent_id )",
    )
    .eq("id", id)
    .maybeSingle();

  if (sigErr || !sigRow) notFound();

  const sig = sigRow as SignalDetail;

  const { data: mRow } = await supabase
    .schema("catalog")
    .from("markets")
    .select("market_symbol")
    .eq("id", sig.market_id)
    .maybeSingle();
  const marketSym = String((mRow as { market_symbol?: string | null } | null)?.market_symbol ?? "").trim();

  const agentSlug = agentSlugFromRow(sig);
  const metaJson =
    sig.metadata != null && typeof sig.metadata === "object" ? JSON.stringify(sig.metadata, null, 2) : "{}";

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="S" />}
          eyebrow="Signal"
          title={marketSym || `Signal ${sig.id.slice(0, 8)}…`}
          titleClassName="font-mono"
          highlights={
            <>
              <Output
                label="Intent"
                type="text"
                value={<span className={intentClass(sig.intent)}>{sig.intent}</span>}
              />
              <Output label="Confidence" type="text" value={fmtConfidence(sig.confidence)} />
              <Output label="Timeframe" type="text" value={sig.timeframe} />
            </>
          }
          meta={sig.id}
          actions={
            <Link href="/signals" className="bk-link text-sm">
              All signals
            </Link>
          }
        />
      }
      content={
        <RecordDetailTabs
          defaultTab="details"
          related={<p className="bk-text-muted text-sm">No linked trade decisions from this page.</p>}
          details={
            <RecordDetailCard>
              <RecordDetailSection title="Details">
                <RecordDetailGrid>
                  <Output label="Signal ID" type="text" value={sig.id} span="full" />
                  <Output
                    label="Market"
                    record={{
                      pathPrefix: "/markets",
                      id: sig.market_id,
                      name: marketSym || sig.market_id.slice(0, 8) + "…",
                    }}
                  />
                  <Output
                    label="Agent"
                    record={{
                      pathPrefix: "/signal-agents",
                      id: sig.signal_agent_id,
                      name: agentSlug ?? sig.signal_agent_id.slice(0, 8) + "…",
                    }}
                  />
                  <Output label="Bar close" type="datetime" value={sig.close_time} formatDatetime={formatDt} />
                  <Output label="Timeframe" type="text" value={sig.timeframe} />
                  <Output label="Created" type="datetime" value={sig.created_at} formatDatetime={formatDt} />
                </RecordDetailGrid>
              </RecordDetailSection>
              <RecordDetailSection title="Reasons">
                <RecordDetailGrid>
                  <Output label="JSON" type="codeblock" value={reasonsJson(sig.reasons)} span="full" />
                </RecordDetailGrid>
              </RecordDetailSection>
              <RecordDetailSection title="Metadata">
                <RecordDetailGrid>
                  <Output label="JSON" type="codeblock" value={metaJson} span="full" />
                </RecordDetailGrid>
              </RecordDetailSection>
            </RecordDetailCard>
          }
        />
      }
    />
  );
}
