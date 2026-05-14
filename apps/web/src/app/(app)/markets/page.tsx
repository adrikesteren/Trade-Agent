import { MarketListRowActions } from "@/app/(app)/markets/market-list-row-actions";
import { OverviewRetrieveBitvavoMarketsButton } from "@/app/(app)/overview/overview-retrieve-bitvavo-markets-button";
import { ListViewPagination } from "@/components/list-view-pagination";
import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatUsdMetric, numericOrNegInf } from "@/lib/format-usd-metric";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
} from "@repo/adricore/blocks";
import Link from "next/link";

type AssetEmbed = {
  id?: string;
  code?: string;
  name?: string | null;
  coingecko_market_cap_usd?: number | string | null;
  coingecko_total_volume_usd?: number | string | null;
};

type MarketListingRow = {
  id: string;
  market_symbol: string;
  assets: unknown;
  quote_asset: unknown;
};

function unwrapAssetEmbed(raw: unknown): AssetEmbed | null {
  const v = (Array.isArray(raw) ? raw[0] : raw) as AssetEmbed | null;
  if (!v || typeof v !== "object") return null;
  return v;
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketsIndexPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();

  const { data: exchange } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .eq("code", "bitvavo")
    .maybeSingle();

  const { data: listings, error } = exchange
    ? await supabase
        .schema("catalog")
        .from("markets")
        .select(
          `
          id,
          market_symbol,
          assets!markets_asset_id_fkey ( id, code, name, coingecko_market_cap_usd, coingecko_total_volume_usd ),
          quote_asset:assets!markets_quote_asset_id_fkey ( id, code, name )
        `,
        )
        .eq("exchange_id", exchange.id)
        .limit(2000)
    : { data: null, error: null };

  const rows = (listings ?? []) as MarketListingRow[];

  function mcapFromRow(row: MarketListingRow): number {
    const asset = unwrapAssetEmbed(row.assets);
    return numericOrNegInf(asset?.coingecko_market_cap_usd ?? null);
  }

  const sortedListings = [...rows].sort((a, b) => {
    const na = mcapFromRow(a);
    const nb = mcapFromRow(b);
    if (nb !== na) return nb - na;
    return (a.market_symbol ?? "").localeCompare(b.market_symbol ?? "", undefined, { sensitivity: "base" });
  });

  const totalCount = sortedListings.length;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);
  const displayListings = sortedListings.slice(from, to + 1);

  const sortLine = [
    `${totalCount} loaded & ranked`,
    `Page ${page} of ${pages}`,
    `${exchange?.name ?? "Bitvavo"}`,
    `${pageSize} per page`,
  ].join(" · ");

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("markets")!}
        rowCount={displayListings.length}
        sortLine={sortLine}
        title="Bitvavo EUR"
        subtitle={
          <>
            Tradable pairs (e.g. BTC-EUR). Base assets live under{" "}
            <Link href="/assets" className="bk-link">
              Assets
            </Link>
            .
          </>
        }
        actions={<OverviewRetrieveBitvavoMarketsButton label="Get From Bitvavo" />}
      />

      <Alert tone="info">
        <span className="bk-form-label" style={{ display: "inline", marginRight: "0.25rem" }}>
          Jobs & history
        </span>
        — Bitvavo sync (listings + candles), CoinGecko snapshots, and{" "}
        <code className="bk-code">sync_runs</code> on{" "}
        <Link href="/sync-runs" className="bk-link">
          Sync runs
        </Link>
        .
      </Alert>

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/markets" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Market</Th>
                  <Th>Asset</Th>
                  <Th>Asset Quote</Th>
                  <Th className="text-right">Market Cap</Th>
                  <Th className="text-right">24h Volume</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {displayListings.map((row) => {
                  const asset = unwrapAssetEmbed(row.assets);
                  const quote = unwrapAssetEmbed(row.quote_asset);
                  const assetName = asset?.name?.trim() ? asset.name : (asset?.code ?? "—");
                  const quoteName = quote?.name?.trim() ? quote.name : (quote?.code ?? "—");
                  const baseMini =
                    asset?.id && asset.code
                      ? { id: String(asset.id), code: String(asset.code), name: asset.name ?? null }
                      : null;
                  const quoteMini =
                    quote?.id && quote.code
                      ? { id: String(quote.id), code: String(quote.code), name: quote.name ?? null }
                      : null;
                  return (
                    <tr key={row.id}>
                      <Td>
                        <span className="font-mono">
                          <Link href={`/markets/${row.id}`} className="bk-link">
                            {row.market_symbol}
                          </Link>
                        </span>
                      </Td>
                      <Td>
                        {baseMini ? (
                          <Link href={`/assets/${encodeURIComponent(baseMini.code)}`} className="bk-link">
                            {assetName}
                          </Link>
                        ) : (
                          assetName
                        )}
                      </Td>
                      <Td>
                        {quoteMini ? (
                          <Link href={`/assets/${encodeURIComponent(quoteMini.code)}`} className="bk-link">
                            {quoteName}
                          </Link>
                        ) : (
                          quoteName
                        )}
                      </Td>
                      <Td className="text-right font-mono">
                        {formatUsdMetric(asset?.coingecko_market_cap_usd ?? null, prefs)}
                      </Td>
                      <Td className="text-right font-mono">
                        {formatUsdMetric(asset?.coingecko_total_volume_usd ?? null, prefs)}
                      </Td>
                      <Td className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                        <MarketListRowActions
                          marketId={row.id}
                          marketSymbol={row.market_symbol}
                          baseAsset={baseMini}
                          quoteAsset={quoteMini}
                        />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
                {!displayListings.length ? (
                  <tr>
                    <Td colSpan={6} muted className="py-8 text-center">
                      No listings yet. Open{" "}
                      <Link href="/sync-runs" className="bk-link">
                        Sync runs
                      </Link>{" "}
                      and use <strong>Sync now</strong> for markets.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/markets" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
