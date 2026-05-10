import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  Breadcrumbs,
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
  RecordRelatedList,
} from "@repo/blocks";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ orderId: string }> };

type OrderDetail = {
  id: string;
  decision_id: string | null;
  executor_id: string;
  market_id: string;
  side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  paper: boolean;
  external_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type FillRow = {
  id: string;
  price: string | number | null;
  quantity: string | number | null;
  fee: string | number | null;
  created_at: string;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "filled") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (s === "open" || s === "pending") return "font-medium text-amber-700 dark:text-amber-400";
  if (s === "rejected" || s === "cancelled") return "bk-text-muted";
  return "";
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { orderId } = await params;
  if (!isUuidLike(orderId)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date | null | undefined) =>
    v == null ? "—" : formatDatetime(v, prefs);
  const fmtQty = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
  const fmtEur = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: orderRow, error: ordErr } = await supabase
    .schema("trading")
    .from("orders")
    .select(
      "id, decision_id, executor_id, market_id, side, quantity, notional_eur, status, paper, external_id, created_at, updated_at",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (ordErr || !orderRow) notFound();

  const order = orderRow as OrderDetail;

  const { data: mRow } = await supabase
    .schema("catalog")
    .from("markets")
    .select("market_symbol")
    .eq("id", order.market_id)
    .maybeSingle();
  const marketSym = String((mRow as { market_symbol?: string | null } | null)?.market_symbol ?? "").trim();

  const { data: exRow } = await supabase
    .schema("trading")
    .from("executors")
    .select("name")
    .eq("id", order.executor_id)
    .maybeSingle();
  const execName = String((exRow as { name?: string | null } | null)?.name ?? "").trim();

  const { data: fillRows, count: fillCount, error: fillErr } = await supabase
    .schema("trading")
    .from("fills")
    .select("id, price, quantity, fee, created_at", { count: "exact" })
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const fills = (fillRows ?? []) as FillRow[];
  const fillTotal = typeof fillCount === "number" ? fillCount : fills.length;

  const titleLabel = marketSym || `Order ${order.id.slice(0, 8)}…`;

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="O" />}
          breadcrumb={<Breadcrumbs items={[{ label: "Orders", href: "/dashboard/orders" }, { label: "Detail" }]} />}
          back={{ href: "/dashboard/orders", label: "← All orders" }}
          eyebrow="Order"
          title={titleLabel}
          titleClassName="font-mono"
          highlights={
            <>
              <Output label="Status" type="text" value={<span className={statusClass(order.status)}>{order.status}</span>} />
              <Output label="Side" type="text" value={order.side} />
              <Output label="Notional (EUR)" type="text" value={fmtEur(order.notional_eur)} />
            </>
          }
          meta={order.id}
        />
      }
      content={
        <>
          {fillErr ? (
            <p className="bk-text-muted text-sm" role="alert">
              {fillErr.message}
            </p>
          ) : null}
          <RecordDetailTabs
            details={
              <RecordDetailCard>
                <RecordDetailSection title="Details">
                  <RecordDetailGrid>
                    <Output label="Order ID" type="text" value={order.id} span="full" />
                    <Output
                      label="Market"
                      record={{
                        pathPrefix: "/dashboard/markets",
                        id: order.market_id,
                        name: marketSym || order.market_id.slice(0, 8) + "…",
                      }}
                    />
                    <Output
                      label="Executor"
                      record={{
                        pathPrefix: "/dashboard/executors",
                        id: order.executor_id,
                        name: execName || order.executor_id.slice(0, 8) + "…",
                      }}
                    />
                    <Output label="Side" type="text" value={order.side} />
                    <Output label="Quantity" type="text" value={fmtQty(order.quantity)} />
                    <Output label="Notional (EUR)" type="text" value={fmtEur(order.notional_eur)} />
                    <Output label="Status" type="text" value={order.status} />
                    <Output label="Paper" type="boolean" value={order.paper} />
                    <Output label="External ID" type="text" value={order.external_id?.trim() ? order.external_id : "—"} />
                    <Output label="Decision ID" type="text" value={order.decision_id ?? "—"} span="full" />
                    <Output label="Created" type="datetime" value={order.created_at} formatDatetime={formatDt} />
                    <Output label="Updated" type="datetime" value={order.updated_at} formatDatetime={formatDt} />
                  </RecordDetailGrid>
                </RecordDetailSection>
              </RecordDetailCard>
            }
            related={
              <RecordDetailCard>
                <RecordRelatedList
                  title="Fills"
                  description="Sorted by created date (newest first)."
                  items={fills}
                  getKey={(f) => f.id}
                  totalCount={fillTotal}
                  viewAllHref={`/dashboard/fills?orderId=${encodeURIComponent(orderId)}`}
                  emptyMessage="No fills for this order yet."
                  renderRow={(f) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="font-mono">
                        @ {fmtQty(f.price)} · qty {fmtQty(f.quantity)} · fee {fmtEur(f.fee)}
                      </span>
                      <span className="bk-text-muted whitespace-nowrap font-mono" style={{ fontSize: "0.75rem" }}>
                        {formatDt(f.created_at)}
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
