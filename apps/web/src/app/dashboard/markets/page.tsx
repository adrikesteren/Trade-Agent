import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatUsdMetric, numericOrNegInf } from "@/lib/format-usd-metric";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

type MarketListingRow = {
  id: string;
  market_symbol: string;
  assets: unknown;
};

export default async function MarketsIndexPage() {
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
          assets ( id, code, name, coingecko_market_cap_usd, coingecko_total_volume_usd )
        `,
        )
        .eq("exchange_id", exchange.id)
        .limit(2000)
    : { data: null, error: null };

  const rows = (listings ?? []) as MarketListingRow[];

  function mcapFromRow(row: MarketListingRow): number {
    const rawA = row.assets as unknown;
    const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as {
      coingecko_market_cap_usd?: number | string | null;
    } | null;
    return numericOrNegInf(asset?.coingecko_market_cap_usd ?? null);
  }

  const sortedListings = [...rows].sort((a, b) => {
    const na = mcapFromRow(a);
    const nb = mcapFromRow(b);
    if (nb !== na) return nb - na;
    return (a.market_symbol ?? "").localeCompare(b.market_symbol ?? "", undefined, { sensitivity: "base" });
  });

  const displayListings = sortedListings.slice(0, DASHBOARD_LIST_VIEW_LIMIT);
  const n = displayListings.length;
  const summaryBits = [
    `${n} listing${n === 1 ? "" : "s"} shown`,
    "Sorted by Market Cap",
    `${exchange?.name ?? "Bitvavo"} · EUR`,
    `Max ${DASHBOARD_LIST_VIEW_LIMIT} rows`,
  ];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="M" />}
        eyebrow="Markets"
        title="Bitvavo EUR"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Tradable pairs (e.g. BTC-EUR). Base assets live under{" "}
            <Link href="/dashboard/assets" className="bk-link">
              Assets
            </Link>
            .
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <>
            <Link href="/dashboard/sync-runs" className={listViewOutlineActionClass}>
              Sync runs
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />

      <Alert tone="info">
        <span className="bk-form-label" style={{ display: "inline", marginRight: "0.25rem" }}>
          Jobs & history
        </span>
        — Bitvavo sync (listings + candles), CoinGecko snapshots, and{" "}
        <code className="bk-code">sync_runs</code> on{" "}
        <Link href="/dashboard/sync-runs" className="bk-link">
          Sync runs
        </Link>
        .
      </Alert>

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Asset Name</Th>
                  <Th>Market</Th>
                  <Th className="text-right">Market Cap</Th>
                  <Th className="text-right">24h Volume</Th>
                </tr>
              </thead>
              <tbody>
                {displayListings.map((row) => {
                  const rawA = row.assets as unknown;
                  const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as {
                    id?: string;
                    code?: string;
                    name?: string | null;
                    coingecko_market_cap_usd?: number | string | null;
                    coingecko_total_volume_usd?: number | string | null;
                  } | null;
                  const assetName = asset?.name?.trim() ? asset.name : (asset?.code ?? "—");
                  return (
                    <tr key={row.id}>
                      <Td>
                        {asset?.id ? (
                          <Link href={`/dashboard/assets/${asset.id}`} className="bk-link">
                            {assetName}
                          </Link>
                        ) : (
                          assetName
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono">
                          <Link href={`/dashboard/markets/${row.id}`} className="bk-link">
                            {row.market_symbol}
                          </Link>
                        </span>
                      </Td>
                      <Td className="text-right font-mono">
                        {formatUsdMetric(asset?.coingecko_market_cap_usd ?? null, prefs)}
                      </Td>
                      <Td className="text-right font-mono">
                        {formatUsdMetric(asset?.coingecko_total_volume_usd ?? null, prefs)}
                      </Td>
                    </tr>
                  );
                })}
                {!displayListings.length ? (
                  <tr>
                    <Td colSpan={4} muted className="py-8 text-center">
                      No listings yet. Open{" "}
                      <Link href="/dashboard/sync-runs" className="bk-link">
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
    </div>
  );
}
