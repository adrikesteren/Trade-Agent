import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
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
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

type AssetRow = {
  id: string;
  code: string;
  kind: string;
  name: string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
};

export default async function AssetsIndexPage() {
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, name, coingecko_market_cap_usd, coingecko_total_volume_usd")
    .order("coingecko_market_cap_usd", { ascending: false, nullsFirst: false })
    .order("code", { ascending: true })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);

  const sortedRows = (rows ?? []) as AssetRow[];

  const n = sortedRows.length;
  const summaryBits = [
    `${n} asset${n === 1 ? "" : "s"}`,
    "Sorted by Market Cap",
    `Max ${DASHBOARD_LIST_VIEW_LIMIT} rows`,
  ];

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
        actions={
          <Link href="/overview" className={listViewOutlineActionClass}>
            Overview
          </Link>
        }
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

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
                      <Link href={`/assets/${r.id}`} className="bk-link">
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
    </div>
  );
}
