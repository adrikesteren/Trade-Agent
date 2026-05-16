import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { getDashboardSession } from "@/lib/supabase/dashboard-session";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import { ensureUserExecutorExists } from "@/lib/agents/executor/services/executors-lookup.service";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExecutorsListPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const { supabase, user } = await getDashboardSession();
  if (!user) redirect("/login");

  let totalCount = 0;
  let countError: { message: string } | null = null;
  try {
    totalCount = await ExecutorsSelector.countForUser(supabase, user.id);
  } catch (e) {
    countError = { message: e instanceof Error ? e.message : String(e) };
  }

  if (!countError && totalCount === 0) {
    await ensureUserExecutorExists(supabase, user.id, { verifiedEmptyExecutorList: true });
    try {
      totalCount = await ExecutorsSelector.countForUser(supabase, user.id);
    } catch (e) {
      countError = { message: e instanceof Error ? e.message : String(e) };
    }
  }

  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: ExecutorsSelector.ExecutorListRow[] = [];
  let error: { message: string } | null = null;
  try {
    list = await ExecutorsSelector.selectListPaginatedForUser(supabase, { userId: user.id, from, to });
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("executors")!}
        rowCount={list.length}
        sortLine={`Portfolios: paper, live, historical backtest, and asset filters Â· Page ${page} of ${pages} Â· ${totalCount} total${countError ? ` Â· ${countError.message}` : ""}`}
        actions={
          <Link href="/executors/new" className={listViewOutlineActionClass}>
            New executor
          </Link>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/executors" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Mode</Th>
                  <Th>Exchange</Th>
                  <Th>Filter</Th>
                  <Th>Enabled</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="font-mono">{row.execution_mode}</Td>
                    <Td className="font-mono">{row.exchange_id}</Td>
                    <Td className="font-mono">{row.asset_filter_mode}</Td>
                    <Td>{row.enabled ? "yes" : "no"}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/executors/${row.id}`} className="bk-link">
                          Open
                        </Link>
                        <Link href={`/executors/new?from=${encodeURIComponent(row.id)}`} className={listViewOutlineActionClass}>
                          Clone
                        </Link>
                      </span>
                    </Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={6} muted className="py-8 text-center">
                      No executors yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/executors" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
