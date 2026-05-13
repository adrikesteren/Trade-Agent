import { OverviewRetrieveBitvavoAssetsButton } from "@/app/(app)/overview/overview-retrieve-bitvavo-assets-button";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatUsdMetric } from "@/lib/format-usd-metric";
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
} from "@repo/adricore/blocks";
import Link from "next/link";

type AssetRow = {
  id: string;
  code: string;
  kind: string;
  name: string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AssetsIndexPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();

  const { count: totalRaw, error: countError } = await supabase
    .schema("catalog")
    .from("assets")
    .select("*", { count: "exact", head: true });
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, name, coingecko_market_cap_usd, coingecko_total_volume_usd")
    .order("coingecko_market_cap_usd", { ascending: false, nullsFirst: false })
    .order("code", { ascending: true })
    .range(from, to);

  const sortedRows = (rows ?? []) as AssetRow[];

  const summaryBits = [
    `${sortedRows.length} on this page`,
    `${totalCount} total`,
    `Page ${page} of ${pages}`,
    "Sorted by Market Cap",
    `${pageSize} per page`,
  ];
  if (countError) {
    summaryBits.push(`Count error: ${countError.message}`);
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="A" />}
        eyebrow="Assets"
        title="All listings"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Base instruments (crypto, later stocks). Pairs live under{" "}
            <Link href="/markets" className="bk-link">
              Markets
            </Link>
            .
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={<OverviewRetrieveBitvavoAssetsButton label="Get From Bitvavo" />}
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/assets" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                  <Th>Kind</Th>
                  <Th className="text-right">Market cap</Th>
                  <Th className="text-right">24h volume</Th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/assets/${encodeURIComponent(String(r.code))}`} className="bk-link">
                        {r.name?.trim() ? r.name : r.code}
                      </Link>
                    </Td>
                    <Td className="font-mono">{r.code}</Td>
                    <Td>{r.kind}</Td>
                    <Td className="text-right font-mono">{formatUsdMetric(r.coingecko_market_cap_usd, prefs)}</Td>
                    <Td className="text-right font-mono">{formatUsdMetric(r.coingecko_total_volume_usd, prefs)}</Td>
                  </tr>
                ))}
                {!sortedRows.length ? (
                  <tr>
                    <Td colSpan={5} muted className="py-8 text-center">
                      No assets yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/assets" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
