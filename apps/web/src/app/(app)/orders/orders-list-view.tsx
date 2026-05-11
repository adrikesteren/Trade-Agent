import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Alert,
  Card,
  CardBody,
  ListViewLayout,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

type OrderRow = {
  id: string;
  decision_id: string | null;
  executor_id: string;
  market_id: string;
  side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  paper: boolean;
  external_id: string | null;
  created_at: string;
};

type CatalogMarketRow = {
  id: string;
  market_symbol?: string | null;
};

const MARKET_ID_CHUNK = 120;

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "filled") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (s === "open" || s === "pending") return "font-medium text-amber-700 dark:text-amber-400";
  if (s === "rejected" || s === "cancelled") return "bk-table-muted";
  return "";
}

async function fetchMarketSymbolsById(
  supabase: SupabaseClient,
  marketIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (marketIds.length === 0) return map;

  for (let i = 0; i < marketIds.length; i += MARKET_ID_CHUNK) {
    const chunk = marketIds.slice(i, i + MARKET_ID_CHUNK);
    const { data, error } = await supabase.schema("catalog").from("markets").select("id, market_symbol").in("id", chunk);
    if (error) {
      console.error("orders list: markets batch:", error.message);
      continue;
    }
    for (const m of (data ?? []) as CatalogMarketRow[]) {
      const sym = String(m.market_symbol ?? "").trim();
      if (sym) map.set(m.id, sym);
    }
  }
  return map;
}

async function fetchExecutorNamesById(
  supabase: SupabaseClient,
  executorIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (executorIds.length === 0) return map;
  const unique = [...new Set(executorIds)];
  for (let i = 0; i < unique.length; i += MARKET_ID_CHUNK) {
    const chunk = unique.slice(i, i + MARKET_ID_CHUNK);
    const { data, error } = await supabase.schema("trading").from("executors").select("id, name").in("id", chunk);
    if (error) {
      console.error("orders list: executors batch:", error.message);
      continue;
    }
    for (const e of data ?? []) {
      map.set(e.id as string, String(e.name ?? "").trim() || (e.id as string));
    }
  }
  return map;
}

export type OrdersListViewProps = {
  executorIdFilter: string | null;
  /** When listing under an executor record, link back to that detail page. */
  parentExecutor?: { id: string; name: string };
};

export async function OrdersListView({ executorIdFilter, parentExecutor }: OrdersListViewProps) {
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "—");
  const fmtQty = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
  const fmtEur = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let q = supabase
    .schema("trading")
    .from("orders")
    .select(
      "id, decision_id, executor_id, market_id, side, quantity, notional_eur, status, paper, external_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_LIST_VIEW_LIMIT);
  if (executorIdFilter) {
    q = q.eq("executor_id", executorIdFilter);
  }
  const { data: rows, error } = await q;

  const list = (rows ?? []) as OrderRow[];
  const marketIds = [...new Set(list.map((r) => r.market_id))];
  const symbolByMarketId = await fetchMarketSymbolsById(supabase, marketIds);
  const executorIds = [...new Set(list.map((r) => r.executor_id).filter(Boolean))];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          eyebrow={parentExecutor ? "Executor · related" : "Trading"}
          title={parentExecutor ? `Orders · ${parentExecutor.name}` : "Orders"}
          iconLetter="O"
          rowCount={list.length}
          sortLine={
            executorIdFilter
              ? `Filtered by executor · sorted by created (newest first) · max ${DASHBOARD_LIST_VIEW_LIMIT} rows`
              : `Sorted by created (newest first) · max ${DASHBOARD_LIST_VIEW_LIMIT} rows`
          }
          actions={
            <>
              {parentExecutor ? (
                <Link href={`/executors/${parentExecutor.id}`} className={listViewOutlineActionClass}>
                  Executor
                </Link>
              ) : null}
              <Link href="/trade-decisions" className={listViewOutlineActionClass}>
                Trade decisions
              </Link>
              <Link href="/fills" className={listViewOutlineActionClass}>
                Fills
              </Link>
              <Link href="/overview" className={listViewOutlineActionClass}>
                Overview
              </Link>
            </>
          }
        />
        {error ? <Alert tone="error">{error.message}</Alert> : null}
        <Card>
          <CardBody className="!pt-0">
            <TableWrap>
              <Table className="text-xs">
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Market</Th>
                    <Th>Executor</Th>
                    <Th>Side</Th>
                    <Th className="text-right">Quantity</Th>
                    <Th className="text-right">Notional (EUR)</Th>
                    <Th>Status</Th>
                    <Th>Paper</Th>
                    <Th>External</Th>
                    <Th>Decision</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const label = symbolByMarketId.get(row.market_id) ?? row.market_id.slice(0, 8) + "…";
                    const ext = row.external_id?.trim() || "—";
                    const exName = executorNameById.get(row.executor_id) ?? row.executor_id?.slice(0, 8) + "…";
                    return (
                      <tr key={row.id}>
                        <Td>
                          <Link href={`/orders/${row.id}`} className="bk-link font-mono" title={row.id}>
                            {row.id.slice(0, 8)}…
                          </Link>
                        </Td>
                        <Td>
                          <Link href={`/markets/${row.market_id}`} className="bk-link font-mono">
                            {label}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={`/executors/${row.executor_id}`} className="bk-link font-mono">
                            {exName}
                          </Link>
                        </Td>
                        <Td className="font-mono">{row.side}</Td>
                        <Td className="text-right font-mono">{fmtQty(row.quantity)}</Td>
                        <Td className="text-right font-mono">{fmtEur(row.notional_eur)}</Td>
                        <Td>
                          <span className={statusClass(row.status)}>{row.status}</span>
                        </Td>
                        <Td>{row.paper ? "yes" : "no"}</Td>
                        <Td className="max-w-[10rem] truncate font-mono" title={ext}>
                          {ext}
                        </Td>
                        <Td className="font-mono">
                          {row.decision_id ? (
                            <span title={row.decision_id}>{row.decision_id.slice(0, 8)}…</span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</Td>
                      </tr>
                    );
                  })}
                  {!list.length ? (
                    <tr>
                      <Td colSpan={11} muted className="py-8 text-center">
                        No orders yet. When the executor runs on approved trade decisions, rows appear here. See{" "}
                        <Link href="/trade-decisions" className="bk-link">
                          Trade decisions
                        </Link>{" "}
                        and{" "}
                        <Link href="/executors" className="bk-link">
                          Executors
                        </Link>
                        .
                      </Td>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </ListViewLayout>
  );
}
