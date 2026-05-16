import { RecordPageTabs } from "@/components/record-page-tabs";
import { RecordTasksRelatedCard } from "@/components/record-tasks-related-card";
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type SignalDetail = {
  id: string;
  signal_agent_id: string;
  candle_id: string;
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

type SignalRowDb = {
  id: string;
  signal_agent_id: string;
  candle_id: string;
  intent: string;
  confidence: number | string | null;
  reasons: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

function flattenSignalDetail(row: SignalRowDb, candle: CatalogCandleBar | undefined): SignalDetail {
  const close_time =
    candle?.close_time && candle.close_time.trim() ? candle.close_time.trim() : row.created_at;
  return {
    id: row.id,
    signal_agent_id: row.signal_agent_id,
    candle_id: row.candle_id,
    market_id: candle?.market_id ? candle.market_id.trim() : "",
    timeframe: candle?.timeframe ? candle.timeframe.trim() || "—" : "—",
    close_time,
    intent: row.intent,
    confidence: row.confidence,
    reasons: row.reasons,
    metadata: row.metadata,
    created_at: row.created_at,
    signal_agents: row.signal_agents,
  };
}

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
      "id, signal_agent_id, candle_id, intent, confidence, reasons, metadata, created_at, signal_agents ( agent_id )",
    )
    .eq("id", id)
    .maybeSingle();

  if (sigErr || !sigRow) notFound();

  const rowDb = sigRow as SignalRowDb;
  const cid = String(rowDb.candle_id ?? "").trim();
  const candleById = await fetchCatalogCandlesByIds(supabase, cid ? [cid] : []);
  const sig = flattenSignalDetail(rowDb, cid ? candleById.get(cid) : undefined);

  const mRow = sig.market_id
    ? await MarketsSelector.selectIdAndSymbolById(supabase, sig.market_id)
    : null;
  const marketSym = sig.market_id ? String(mRow?.market_symbol ?? "").trim() : "";

  const agentSlug = agentSlugFromRow(sig);
  const metaJson =
    sig.metadata != null && typeof sig.metadata === "object" ? JSON.stringify(sig.metadata, null, 2) : "{}";

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={objectRegistry.registrations.get("signals")!.CreateDetailPageHeader({
        record: sig as Record<string, unknown>,
        title: marketSym || (sig.market_id ? `Market ${sig.market_id.slice(0, 8)}…` : `Signal ${sig.id.slice(0, 8)}…`),
        titleClassName: "font-mono",
        highlights: (
          <>
            <Output
              label="Intent"
              type="text"
              value={<span className={intentClass(sig.intent)}>{sig.intent}</span>}
            />
            <Output label="Confidence" type="text" value={fmtConfidence(sig.confidence)} />
            <Output label="Timeframe" type="text" value={sig.timeframe} />
          </>
        ),
        actions: (
          <Link href="/signals" className="bk-link text-sm">
            All signals
          </Link>
        ),
      })}
      sidebar={<RecordTasksRelatedCard relatedSchema="trading" relatedTable="signals" relatedId={sig.id} />}
      content={
        <RecordPageTabs
          defaultTab="details"
          details={
            <RecordPageCard>
              <RecordPageSection title="Details">
                <RecordPageGrid>
                  <Output label="Signal ID" type="text" value={sig.id} span="full" />
                  {sig.market_id ? (
                    <Output
                      label="Market"
                      record={{
                        pathPrefix: "/markets",
                        id: sig.market_id,
                        name: marketSym || sig.market_id.slice(0, 8) + "…",
                      }}
                    />
                  ) : (
                    <Output label="Market" type="text" value="—" />
                  )}
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
                </RecordPageGrid>
              </RecordPageSection>
              <RecordPageSection title="Reasons">
                <RecordPageGrid>
                  <Output label="JSON" type="codeblock" value={reasonsJson(sig.reasons)} span="full" />
                </RecordPageGrid>
              </RecordPageSection>
              <RecordPageSection title="Metadata">
                <RecordPageGrid>
                  <Output label="JSON" type="codeblock" value={metaJson} span="full" />
                </RecordPageGrid>
              </RecordPageSection>
            </RecordPageCard>
          }
          related={
            <div className="bk-stack bk-stack_gap-md">
              <p className="bk-text-muted text-sm">No linked trade decisions from this page.</p>
            </div>
          }
        />
      }
    />
  );
}
