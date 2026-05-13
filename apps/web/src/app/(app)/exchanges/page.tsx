import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
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

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExchangesIndexPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  const { count: totalRaw, error: countError } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("*", { count: "exact", head: true });
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .order("code", { ascending: true })
    .range(from, to);

  const list = rows ?? [];
  const summaryBits = [
    `${list.length} on this page`,
    `${totalCount} total`,
    `Page ${page} of ${pages}`,
    "Sorted by Code",
    `${pageSize} per page`,
  ];
  if (countError) summaryBits.push(`Count: ${countError.message}`);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="E" />}
        eyebrow="Exchanges"
        title="Directory"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Venues that host{" "}
            <Link href="/markets" className="bk-link">
              markets
            </Link>{" "}
            (catalog reference data).
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/exchanges" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/exchanges/${r.id}`} className="bk-link">
                        {r.name?.trim() ? r.name : r.code}
                      </Link>
                    </Td>
                    <Td className="font-mono">{r.code}</Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={2} muted className="py-8 text-center">
                      No exchanges in the database yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/exchanges" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
