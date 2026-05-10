import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatDatetime } from "@/lib/locale/format";
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
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ exchangeId: string }> };

export default async function ExchangeDetailPage({ params }: PageProps) {
  const { exchangeId } = await params;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { data: ex, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name, created_at")
    .eq("id", exchangeId)
    .maybeSingle();

  if (error || !ex) {
    notFound();
  }

  const { data: markets, count } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_code, status", { count: "exact" })
    .eq("exchange_id", exchangeId)
    .order("market_symbol", { ascending: true })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const list = markets ?? [];
  const marketTotal = typeof count === "number" ? count : list.length;
  const countLabel = String(marketTotal);

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="E" />}
          breadcrumb={
            <Breadcrumbs items={[{ label: "Exchanges", href: "/dashboard/exchanges" }, { label: "Detail" }]} />
          }
          back={{ href: "/dashboard/exchanges", label: "← All exchanges" }}
          eyebrow="Exchange"
          title={ex.name}
          highlights={
            <>
              <Output label="Code" type="text" value={ex.code} />
              <Output label="Markets" type="text" value={countLabel} />
            </>
          }
          meta={`id: ${ex.id}`}
        />
      }
      content={
        <RecordDetailTabs
          details={
            <RecordDetailCard>
              <RecordDetailSection title="Details">
                <RecordDetailGrid>
                  <Output label="Record ID" type="text" value={ex.id} span="full" />
                  <Output label="Code" type="text" value={ex.code} />
                  <Output label="Name" type="text" value={ex.name?.trim() ? ex.name : "—"} />
                  <Output label="Created" type="datetime" value={ex.created_at} formatDatetime={formatDt} />
                </RecordDetailGrid>
              </RecordDetailSection>
            </RecordDetailCard>
          }
          related={
            <RecordDetailCard>
              <RecordRelatedList
                title="Markets"
                description={
                  marketTotal > list.length
                    ? `Preview: first ${list.length} of ${marketTotal} listings.`
                    : marketTotal > 0
                      ? `${marketTotal} listing${marketTotal === 1 ? "" : "s"}.`
                      : undefined
                }
                items={list}
                getKey={(m) => m.id}
                totalCount={typeof count === "number" ? count : undefined}
                viewAllHref="/dashboard/markets"
                emptyMessage="No markets synced for this exchange yet."
                renderRow={(m) => (
                  <>
                    <Link href={`/dashboard/markets/${m.id}`} className="bk-link font-mono" style={{ fontWeight: 600 }}>
                      {m.market_symbol}
                    </Link>
                    <span className="bk-text-muted ml-2" style={{ fontSize: "0.75rem" }}>
                      {m.quote_code} · {m.status}
                    </span>
                  </>
                )}
              />
            </RecordDetailCard>
          }
        />
      }
    />
  );
}
