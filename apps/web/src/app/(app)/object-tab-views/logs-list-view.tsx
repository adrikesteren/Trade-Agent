import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody, Table, TableWrap, Td, Th } from "@repo/adricore/blocks";
import Link from "next/link";

type LogListRow = {
  id: string;
  level: string;
  message: string;
  context: string | null;
  created_at: string | null;
};

type LogsListViewProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const MESSAGE_PREVIEW_LEN = 120;

function previewMessage(s: string): string {
  const t = s.trim();
  if (t.length <= MESSAGE_PREVIEW_LEN) return t;
  return `${t.slice(0, MESSAGE_PREVIEW_LEN)}…`;
}

/** Logs list — used by `(app)/[tabSlug]` when `tabSlug` is `logs`. */
export async function LogsListView({ searchParams }: LogsListViewProps) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { count: totalRaw, error: countError } = await supabase
    .from("logs")
    .select("*", { count: "exact", head: true });

  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: rows, error } = await supabase
    .from("logs")
    .select("id, level, message, context, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  const list = (rows ?? []) as LogListRow[];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("logs")!}
        rowCount={list.length}
        sortLine={`Append-only events (errors, warnings, info) · Page ${page} of ${pages} · ${totalCount} total${countError ? ` · ${countError.message}` : ""}`}
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <ListViewPagination pathname="/logs" page={page} pageSize={pageSize} totalCount={totalCount} />

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Level</Th>
                  <Th>Message</Th>
                  <Th>Context</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap">{row.created_at ? formatDt(row.created_at) : "—"}</Td>
                    <Td className="font-mono">{row.level}</Td>
                    <Td className="max-w-[24rem]">{previewMessage(row.message)}</Td>
                    <Td className="font-mono text-balance">{row.context ?? "—"}</Td>
                    <Td>
                      <Link href={`/logs/${row.id}`} className="bk-link">
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={5} muted className="py-8 text-center">
                      No log entries yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <ListViewPagination pathname="/logs" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
