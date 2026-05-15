import { AssetCoingeckoHeaderActions } from "@/app/(app)/assets/[slug]/asset-set-coingecko-id-dialog";
import { AssetDetailDeleteHeaderActions } from "@/app/(app)/assets/[slug]/asset-detail-delete-header-actions";
import { AssetCoingeckoDetailOutputs } from "@/components/asset-coingecko-detail-outputs";
import { type AssetLiveCoingeckoDb } from "@/components/asset-coingecko-metrics-block";
import { RecordPageTabs } from "@/components/record-page-tabs";
import { RecordTasksRelatedCard } from "@/components/record-tasks-related-card";
import { isCatalogAssetDetailRouteUuid, normalizeCatalogAssetRouteSlug } from "@/lib/catalog/asset-detail-route-slug";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { isFiatQuoteCurrencyCode } from "@/lib/markets/fiat-quote-currency-codes";
import { isRelayWorkerEnqueueConfigured } from "@/lib/relay/relay-symbol-close-pipeline-client";
import { objectRegistry } from "@/lib/objects/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID } from "@/lib/tasks/constants";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
  RecordRelatedList,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ slug: string }> };

const ASSET_CG_FIELDS =
  "coingecko_fetched_at, coingecko_coin_id, coingecko_price_usd, coingecko_market_cap_usd, coingecko_fdv_usd, coingecko_total_volume_usd, coingecko_high_24h_usd, coingecko_low_24h_usd, coingecko_price_change_24h_usd, coingecko_price_change_24h_pct, coingecko_price_change_7d_pct, coingecko_market_cap_rank, coingecko_circulating_supply, coingecko_total_supply, coingecko_max_supply, coingecko_ath_usd, coingecko_ath_change_pct";

export default async function AssetDetailPage({ params }: PageProps) {
  const { slug: slugParam } = await params;
  const slug = normalizeCatalogAssetRouteSlug(slugParam);
  if (!slug) {
    notFound();
  }

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const fields = `id, code, kind, name, metadata, created_at, ${ASSET_CG_FIELDS}`;
  let assetQuery = supabase.schema("catalog").from("assets").select(fields);
  if (isCatalogAssetDetailRouteUuid(slug)) {
    assetQuery = assetQuery.eq("id", slug);
  } else {
    const code = slug.toUpperCase();
    if (isFiatQuoteCurrencyCode(code)) {
      assetQuery = assetQuery.eq("code", code).eq("kind", "fiat");
    } else {
      assetQuery = assetQuery.eq("code", code).in("kind", ["crypto", "stock"]);
    }
  }

  const { data: asset, error } = await assetQuery.maybeSingle();

  if (error || !asset) {
    notFound();
  }

  const assetId = asset.id as string;

  const { data: markets, count: marketCount } = await supabase
    .schema("catalog")
    .from("markets")
    .select(
      `
      id,
      market_symbol,
      status,
      quote_asset:assets!markets_quote_asset_id_fkey ( code, kind ),
      exchanges ( id, code, name )
    `,
      { count: "exact" },
    )
    .eq("asset_id", assetId)
    .order("market_symbol", { ascending: true })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const isCrypto = asset.kind === "crypto";
  const meta =
    asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : {};
  const coingeckoIdHint = typeof meta.coingecko_id === "string" ? meta.coingecko_id : null;

  const assetLive = asset as AssetLiveCoingeckoDb;
  const marketRows = markets ?? [];
  const pairCount = typeof marketCount === "number" ? marketCount : marketRows.length;
  const relayEnqueueConfigured = await isRelayWorkerEnqueueConfigured();
  const coingeckoIdEmpty = !String(assetLive.coingecko_coin_id ?? "").trim();
  let hasOpenSkipAutoCoingeckoCoinIdTask = false;
  if (isCrypto && coingeckoIdEmpty) {
    const admin = createServiceRoleClient();
    const { data: skipTaskRow } = await admin
      .from("tasks")
      .select("id")
      .eq("related_schema", "catalog")
      .eq("related_table", "assets")
      .eq("related_id", assetId)
      .eq("status", "open")
      .eq("job_identifier", JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID)
      .maybeSingle();
    hasOpenSkipAutoCoingeckoCoinIdTask = Boolean(skipTaskRow?.id);
  }

  return (
    <DetailPageLayout
      className="bk-container px-1"
      header={objectRegistry.registrations.get("assets")!.CreateDetailPageHeader({
        record: asset as Record<string, unknown>,
        title: (
          <>
            {asset.name ?? asset.code}{" "}
            <span className="font-mono bk-text-muted" style={{ fontSize: "1.125rem", fontWeight: 500 }}>
              ({asset.code})
            </span>
          </>
        ),
        highlights: (
          <>
            <Output label="Code" type="text" value={asset.code} />
            <Output label="Kind" type="text" value={asset.kind} />
            <Output label="Pairs" type="number" value={pairCount} />
          </>
        ),
        subtitle: "Catalog base instrument. Linked markets use this asset as the tradable base.",
        actions: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isCrypto ? (
              <AssetCoingeckoHeaderActions
                assetId={assetId}
                coingeckoCoinId={assetLive.coingecko_coin_id}
                relayEnqueueConfigured={relayEnqueueConfigured && !hasOpenSkipAutoCoingeckoCoinIdTask}
              />
            ) : null}
            <AssetDetailDeleteHeaderActions
              assetId={assetId}
              assetCode={String(asset.code ?? "")}
              assetName={String(asset.name ?? "")}
            />
          </div>
        ),
      })}
      sidebar={<RecordTasksRelatedCard relatedSchema="catalog" relatedTable="assets" relatedId={assetId} />}
      content={
        <RecordPageTabs
          defaultTab="details"
          details={
            <RecordPageCard>
              <RecordPageSection title="Details">
                <RecordPageGrid>
                  <Output label="Record ID" type="text" value={asset.id} span="full" />
                  <Output label="Code" type="text" value={asset.code} />
                  <Output label="Kind" type="text" value={asset.kind} />
                  <Output label="Name" type="text" value={asset.name?.trim() ? asset.name : "—"} />
                  {isCrypto ? (
                    <AssetCoingeckoDetailOutputs
                      asset={assetLive}
                      metadataCoingeckoId={coingeckoIdHint}
                      localePrefs={prefs}
                      formatDt={formatDt}
                    />
                  ) : (
                    <Output
                      label="CoinGecko"
                      type="text"
                      value="Live USD fields are only collected for crypto assets in the catalog."
                      span="full"
                    />
                  )}
                  <Output label="Created" type="datetime" value={asset.created_at} formatDatetime={formatDt} />
                </RecordPageGrid>
              </RecordPageSection>
            </RecordPageCard>
          }
          related={
            <div className="bk-stack bk-stack_gap-md">
              <RecordRelatedList
                title="Markets (pairs)"
                icon={<ListViewObjectIcon letter="M" />}
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
                viewAllHref="/markets"
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
                        <Link href={`/markets/${m.id}`} className="bk-link font-mono">
                          {m.market_symbol}
                        </Link>
                        <div className="flex items-center gap-2 bk-text-muted" style={{ fontSize: "0.75rem" }}>
                          {ex?.id ? (
                            <Link href={`/exchanges/${ex.id}`} className="bk-link">
                              {ex.code ?? "—"}
                            </Link>
                          ) : (
                            <span>{ex?.code ?? "—"}</span>
                          )}
                          <span>·</span>
                          <span>
                            {(() => {
                              const rawQ = m.quote_asset as unknown;
                              const qa = (Array.isArray(rawQ) ? rawQ[0] : rawQ) as { code?: string } | null;
                              return String(qa?.code ?? "—");
                            })()}
                          </span>
                          <span>·</span>
                          <span>{m.status}</span>
                        </div>
                      </div>
                    );
                  }}
                />
            </div>
          }
        />
      }
    />
  );
}
