import {
  AssetCoingeckoMetricsBlock,
  AssetCoingeckoMetricsNoSnapshot,
  AssetCoingeckoMetricsPlaceholder,
  buildAssetCoingeckoMetricsRow,
  type AssetLiveCoingeckoDb,
} from "@/components/asset-coingecko-metrics-block";
import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
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

type PageProps = { params: Promise<{ assetId: string }> };

const ASSET_CG_FIELDS =
  "coingecko_fetched_at, coingecko_coin_id, coingecko_price_usd, coingecko_market_cap_usd, coingecko_fdv_usd, coingecko_total_volume_usd, coingecko_high_24h_usd, coingecko_low_24h_usd, coingecko_price_change_24h_usd, coingecko_price_change_24h_pct, coingecko_price_change_7d_pct, coingecko_market_cap_rank, coingecko_circulating_supply, coingecko_total_supply, coingecko_max_supply, coingecko_ath_usd, coingecko_ath_change_pct";

export default async function AssetDetailPage({ params }: PageProps) {
  const { assetId } = await params;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { data: asset, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select(`id, code, kind, name, metadata, created_at, ${ASSET_CG_FIELDS}`)
    .eq("id", assetId)
    .maybeSingle();

  if (error || !asset) {
    notFound();
  }

  const { data: markets, count: marketCount } = await supabase
    .schema("catalog")
    .from("markets")
    .select(
      `
      id,
      market_symbol,
      quote_code,
      status,
      exchanges ( id, code, name )
    `,
      { count: "exact" },
    )
    .eq("asset_id", assetId)
    .order("market_symbol", { ascending: true })
    .limit(10);

  const isCrypto = asset.kind === "crypto";
  const meta =
    asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : {};
  const coingeckoIdHint = typeof meta.coingecko_id === "string" ? meta.coingecko_id : null;

  const cgRow = isCrypto ? buildAssetCoingeckoMetricsRow(asset as AssetLiveCoingeckoDb, coingeckoIdHint) : null;
  const marketRows = markets ?? [];
  const pairCount = typeof marketCount === "number" ? marketCount : marketRows.length;

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="A" />}
          breadcrumb={<Breadcrumbs items={[{ label: "Assets", href: "/dashboard/assets" }, { label: "Detail" }]} />}
          back={{ href: "/dashboard/assets", label: "← All assets" }}
          eyebrow="Asset"
          title={
            <>
              {asset.name ?? asset.code}{" "}
              <span className="font-mono bk-text-muted" style={{ fontSize: "1.125rem", fontWeight: 500 }}>
                ({asset.code})
              </span>
            </>
          }
          highlights={
            <>
              <Output label="Code" type="text" value={asset.code} />
              <Output label="Kind" type="text" value={asset.kind} />
              <Output label="Pairs" type="number" value={pairCount} />
            </>
          }
          subtitle="Catalog base instrument. Linked markets use this asset as the tradable base."
          meta={`id: ${asset.id}`}
        />
      }
      content={
        <RecordDetailTabs
          details={
            <div className="bk-stack bk-stack_gap-md">
              {isCrypto && coingeckoIdHint ? (
                <Alert tone="info" className="text-xs">
                  <span className="bk-form-label" style={{ display: "inline" }}>
                    CoinGecko id (catalog)
                  </span>
                  : <span className="font-mono">{coingeckoIdHint}</span>
                </Alert>
              ) : null}

              {isCrypto && cgRow ? (
                <AssetCoingeckoMetricsBlock row={cgRow} assetCode={asset.code} localePrefs={prefs} />
              ) : isCrypto ? (
                <AssetCoingeckoMetricsNoSnapshot
                  assetCode={asset.code}
                  resolvedCoingeckoId={coingeckoIdHint}
                  localePrefs={prefs}
                />
              ) : (
                <AssetCoingeckoMetricsPlaceholder reason="non_crypto" />
              )}

              <RecordDetailCard>
                <RecordDetailSection title="Details">
                  <RecordDetailGrid>
                    <Output label="Record ID" type="text" value={asset.id} span="full" />
                    <Output label="Code" type="text" value={asset.code} />
                    <Output label="Kind" type="text" value={asset.kind} />
                    <Output label="Name" type="text" value={asset.name?.trim() ? asset.name : "—"} />
                    <Output label="Created" type="datetime" value={asset.created_at} formatDatetime={formatDt} />
                  </RecordDetailGrid>
                </RecordDetailSection>
              </RecordDetailCard>
            </div>
          }
          related={
            <RecordDetailCard>
              <RecordRelatedList
                title="Markets (pairs)"
                description={
                  pairCount > marketRows.length
                    ? `Preview: first ${marketRows.length} of ${pairCount} listings using this asset as base.`
                    : pairCount > 0
                      ? `Listings that use this asset as base.`
                      : undefined
                }
                items={marketRows}
                getKey={(m) => m.id}
                totalCount={typeof marketCount === "number" ? marketCount : undefined}
                viewAllHref="/dashboard/markets"
                emptyMessage="No market listings linked yet."
                renderRow={(m) => {
                  const rawEx = m.exchanges as unknown;
                  const ex = (Array.isArray(rawEx) ? rawEx[0] : rawEx) as {
                    id?: string;
                    code?: string;
                    name?: string;
                  } | null;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2" style={{ fontSize: "0.8125rem" }}>
                      <Link href={`/dashboard/markets/${m.id}`} className="bk-link font-mono">
                        {m.market_symbol}
                      </Link>
                      <div className="flex items-center gap-2 bk-text-muted" style={{ fontSize: "0.75rem" }}>
                        {ex?.id ? (
                          <Link href={`/dashboard/exchanges/${ex.id}`} className="bk-link">
                            {ex.code ?? "—"}
                          </Link>
                        ) : (
                          <span>{ex?.code ?? "—"}</span>
                        )}
                        <span>·</span>
                        <span>{m.status}</span>
                      </div>
                    </div>
                  );
                }}
              />
            </RecordDetailCard>
          }
        />
      }
    />
  );
}
