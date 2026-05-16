import { ListViewPagination } from "@/components/list-view-pagination";
import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExchangesIndexPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let totalCount = 0;
  let countError: Error | null = null;
  try {
    totalCount = await ExchangesSelector.countAll(supabase);
  } catch (e) {
    countError = e instanceof Error ? e : new Error(String(e));
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: { id: string; code: string; name: string | null }[] = [];
  let error: Error | null = null;
  try {
    list = await ExchangesSelector.selectAllPaginatedOrderedByCode(supabase, { from, to });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }
  const sortLineParts = [
    `${totalCount} total`,
    `Page ${page} of ${pages}`,
    "Sorted by Code",
    `${pageSize} per page`,
  ];
  if (countError) sortLineParts.push(`Count: ${countError.message}`);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("exchanges")!}
        rowCount={list.length}
        sortLine={sortLineParts.join(" Â· ")}
        subtitle={
          <>
            Venues that host{" "}
            <Link href="/markets" className="bk-link">
              markets
            </Link>{" "}
            (catalog reference data).
          </>
        }
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
