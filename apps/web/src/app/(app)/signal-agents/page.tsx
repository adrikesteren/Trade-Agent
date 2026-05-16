import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { objectRegistry } from "@/lib/objects/registry";
import * as SignalAgentsSelector from "@/lib/selectors/signal-agents-selector";
import { createClient } from "@/lib/supabase/server";
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

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignalAgentsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();

  let totalCount = 0;
  let countError: Error | null = null;
  try {
    totalCount = await SignalAgentsSelector.countAll(supabase);
  } catch (e) {
    countError = e instanceof Error ? e : new Error(String(e));
  }
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  let list: Awaited<ReturnType<typeof SignalAgentsSelector.selectAllPaginatedOrderedByCreatedAt>> = [];
  let error: Error | null = null;
  try {
    list = await SignalAgentsSelector.selectAllPaginatedOrderedByCreatedAt(supabase, { from, to });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("signal_agents")!}
        rowCount={list.length}
        sortLine={`Sorted by Created date Â· Page ${page} of ${pages} Â· ${totalCount} total${countError ? ` Â· ${countError.message}` : ""}`}
        actions={
          <Link href="/signals" className={listViewOutlineActionClass}>
            Signals
          </Link>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/signal-agents" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Agent key</Th>
                  <Th>Enabled</Th>
                  <Th>Version</Th>
                  <Th>Description</Th>
                  <Th>Updated (UTC)</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id as string}>
                    <Td>
                      <Link href={`/signal-agents/${row.id}`} className="bk-link font-mono">
                        {row.agent_id as string}
                      </Link>
                    </Td>
                    <Td>{row.enabled ? "Yes" : "No"}</Td>
                    <Td>{(row.version as string | null)?.trim() || "â€”"}</Td>
                    <Td className="max-w-md truncate" title={(row.description as string | null) ?? undefined}>
                      {(row.description as string | null)?.trim() || "â€”"}
                    </Td>
                    <Td className="whitespace-nowrap font-mono">
                      {row.updated_at
                        ? String(row.updated_at).slice(0, 19).replace("T", " ")
                        : "â€”"}
                    </Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={5} muted className="py-8 text-center">
                      No signal agents. Run migrations â€” the seed inserts <code className="bk-code">ma-cross-15m-v1</code>.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/signal-agents" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
