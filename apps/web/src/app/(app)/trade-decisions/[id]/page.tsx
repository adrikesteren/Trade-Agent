import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
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
  RecordRelatedList,
} from "@repo/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

type TradeDecisionDetail = {
  id: string;
  user_id: string;
  executor_id: string;
  market_id: string;
  signal_id: string | null;
  approved: boolean;
  reason_codes: string[] | null;
  close_time: string;
  timeframe: string;
  decision_payload: Record<string, unknown> | null;
  risk_snapshot: Record<string, unknown> | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  side: string;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function resolvedIntentFromPayload(payload: Record<string, unknown> | null): string {
  return payloadString(payload, "resolvedIntent") ?? "—";
}

function intentClass(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT" || intent === "REDUCE") return "font-medium text-amber-700 dark:text-amber-400";
  if (intent === "HOLD") return "bk-text-muted";
  return "";
}

function approvedClass(approved: boolean): string {
  return approved ? "font-medium text-emerald-700 dark:text-emerald-400" : "bk-text-muted";
}

function formatReasonCodes(codes: string[] | null | undefined): string {
  if (!codes?.length) return "—";
  return codes.join(", ");
}

function orderStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "filled") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (s === "open" || s === "pending") return "font-medium text-amber-700 dark:text-amber-400";
  if (s === "rejected" || s === "cancelled") return "bk-text-muted";
  return "";
}

export default async function TradeDecisionDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null | undefined) =>
    v == null ? "—" : formatDatetime(v, prefs);
  const fmtEur = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: decRow, error: decErr } = await supabase
    .schema("trading")
    .from("trade_decisions")
    .select(
      "id, user_id, executor_id, market_id, signal_id, approved, reason_codes, close_time, timeframe, decision_payload, risk_snapshot, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (decErr || !decRow) notFound();

  const dec = decRow as TradeDecisionDetail;

  const { data: mRow } = await supabase
    .schema("catalog")
    .from("markets")
    .select("market_symbol")
    .eq("id", dec.market_id)
    .maybeSingle();
  const marketSym = String((mRow as { market_symbol?: string | null } | null)?.market_symbol ?? "").trim();

  const { data: exRow } = await supabase
    .schema("trading")
    .from("executors")
    .select("name")
    .eq("id", dec.executor_id)
    .maybeSingle();
  const execName = String((exRow as { name?: string | null } | null)?.name ?? "").trim();

  const { data: ordRows, count: ordCount, error: ordErr } = await supabase
    .schema("trading")
    .from("orders")
    .select("id, side, notional_eur, status, created_at", { count: "exact" })
    .eq("decision_id", id)
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const orders = (ordRows ?? []) as OrderRow[];
  const orderTotal = typeof ordCount === "number" ? ordCount : orders.length;

  const resolved = resolvedIntentFromPayload(dec.decision_payload);
  const reasons = formatReasonCodes(dec.reason_codes);
  const payloadJson =
    dec.decision_payload != null && typeof dec.decision_payload === "object"
      ? JSON.stringify(dec.decision_payload, null, 2)
      : "{}";
  const riskJson =
    dec.risk_snapshot != null && typeof dec.risk_snapshot === "object"
      ? JSON.stringify(dec.risk_snapshot, null, 2)
      : "{}";

  const titleLabel = marketSym || `Decision ${dec.id.slice(0, 8)}…`;

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="D" />}
          eyebrow="Trade decision"
          title={titleLabel}
          titleClassName="font-mono"
          highlights={
            <>
              <Output
                label="Resolved"
                type="text"
                value={<span className={intentClass(resolved)}>{resolved}</span>}
              />
              <Output
                label="Approved"
                type="text"
                value={<span className={approvedClass(dec.approved)}>{dec.approved ? "yes" : "no"}</span>}
              />
              <Output label="Timeframe" type="text" value={dec.timeframe} />
            </>
          }
          meta={dec.id}
          actions={
            <Link href="/trade-decisions" className="bk-link text-sm">
              All trade decisions
            </Link>
          }
        />
      }
      content={
        <>
          {ordErr ? (
            <p className="bk-text-muted text-sm" role="alert">
              {ordErr.message}
            </p>
          ) : null}
          <RecordDetailTabs
            details={
              <RecordDetailCard>
                <RecordDetailSection title="Details">
                  <RecordDetailGrid>
                    <Output label="Decision ID" type="text" value={dec.id} span="full" />
                    <Output
                      label="Market"
                      record={{
                        pathPrefix: "/markets",
                        id: dec.market_id,
                        name: marketSym || dec.market_id.slice(0, 8) + "…",
                      }}
                    />
                    <Output
                      label="Executor"
                      record={{
                        pathPrefix: "/executors",
                        id: dec.executor_id,
                        name: execName || dec.executor_id.slice(0, 8) + "…",
                      }}
                    />
                    <Output label="Bar close" type="datetime" value={dec.close_time} formatDatetime={formatDt} />
                    <Output label="Timeframe" type="text" value={dec.timeframe} />
                    <Output label="Signal ID" type="text" value={dec.signal_id ?? "—"} span="full" />
                    <Output label="Reason codes" type="text" value={reasons} span="full" />
                    <Output label="Created" type="datetime" value={dec.created_at} formatDatetime={formatDt} />
                  </RecordDetailGrid>
                </RecordDetailSection>
                <RecordDetailSection title="Decision payload">
                  <RecordDetailGrid>
                    <Output label="JSON" type="codeblock" value={payloadJson} span="full" />
                  </RecordDetailGrid>
                </RecordDetailSection>
                <RecordDetailSection title="Risk snapshot">
                  <RecordDetailGrid>
                    <Output label="JSON" type="codeblock" value={riskJson} span="full" />
                  </RecordDetailGrid>
                </RecordDetailSection>
              </RecordDetailCard>
            }
            related={
              <RecordDetailCard>
                <RecordRelatedList
                  title="Orders"
                  description="Orders linked to this decision (newest first)."
                  items={orders}
                  getKey={(o) => o.id}
                  totalCount={orderTotal}
                  viewAllHref={`/orders?executorId=${encodeURIComponent(dec.executor_id)}`}
                  emptyMessage="No orders linked to this decision yet."
                  renderRow={(o) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <Link href={`/orders/${o.id}`} className="bk-link font-mono" title={o.id}>
                        {o.id.slice(0, 8)}…
                      </Link>
                      <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                        <span className="font-mono">{o.side}</span> · {fmtEur(o.notional_eur)} ·{" "}
                        <span className={orderStatusClass(o.status)}>{o.status}</span> ·{" "}
                        <span className="whitespace-nowrap font-mono">{formatDt(o.created_at)}</span>
                      </span>
                    </div>
                  )}
                />
              </RecordDetailCard>
            }
          />
        </>
      }
    />
  );
}
