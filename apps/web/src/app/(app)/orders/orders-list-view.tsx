import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { PositionSidePill } from "@/components/position-side-pill";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import * as OrdersSelector from "@/lib/selectors/orders-selector";
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
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";

type OrderRow = {
  id: string;
  decision_id: string | null;
  executor_id: string;
  market_id: string;
  side: string;
  position_side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  paper: boolean;
  external_id: string | null;
  created_at: string;
};

type OrderRowRaw = Omit<OrderRow, "market_id"> & {
  decisions?: {
    signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
  } | null;
};

type CatalogMarketRow = {
  id: string;
  market_symbol?: string | null;
};

const MARKET_ID_CHUNK = 120;

function unwrapOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toOrderRow(r: OrderRowRaw, candleById: Map<string, CatalogCandleBar>): OrderRow {
  const td = unwrapOne(r.decisions);
  const sig = unwrapOne(td?.signals);
  const cid = String(sig?.candle_id ?? "").trim();
  const c = cid ? candleById.get(cid) : undefined;
  const market_id = c?.market_id ? c.market_id.trim() : "";
  return {
    id: r.id,
    decision_id: r.decision_id,
    executor_id: r.executor_id,
    market_id,
    side: r.side,
    position_side: String((r as { position_side?: string | null }).position_side ?? "long"),
    quantity: r.quantity,
    notional_eur: r.notional_eur,
    status: r.status,
    paper: r.paper,
    external_id: r.external_id,
    created_at: r.created_at,
  };
}

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
    let rows: Awaited<ReturnType<typeof MarketsSelector.selectIdAndSymbolByIds>>;
    try {
      rows = await MarketsSelector.selectIdAndSymbolByIds(supabase, chunk);
    } catch (e) {
      console.error("orders list: markets batch:", e instanceof Error ? e.message : String(e));
      continue;
    }
    for (const m of rows) {
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
    let rows: Awaited<ReturnType<typeof ExecutorsSelector.selectIdAndNameByIds>>;
    try {
      rows = await ExecutorsSelector.selectIdAndNameByIds(supabase, chunk);
    } catch (e) {
      console.error("orders list: executors batch:", e instanceof Error ? e.message : String(e));
      continue;
    }
    for (const e of rows) {
      map.set(e.id, String(e.name ?? "").trim() || e.id);
    }
  }
  return map;
}

export type OrdersListViewProps = {
  executorIdFilter: string | null;
  /** When listing under an executor record, link back to that detail page. */
  parentExecutor?: { id: string; name: string };
  paginationPathname: string;
  page: number;
};

export async function OrdersListView({
  executorIdFilter,
  parentExecutor,
  paginationPathname,
  page: pageRaw,
}: OrdersListViewProps) {
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "â€”");
  const fmtQty = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
  const fmtEur = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { count: totalRaw, error: countError } = await OrdersSelector.countListView(supabase, {
    executorIdFilter,
  });
  const totalCount = totalRaw ?? 0;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);

  const { data: rows, error } = await OrdersSelector.selectListViewPaginated(supabase, {
    from,
    to,
    executorIdFilter,
  });

  const raw = (rows ?? []) as OrderRowRaw[];
  const candleIds = raw
    .map((r) => {
      const td = unwrapOne(r.decisions);
      const sig = unwrapOne(td?.signals);
      return String(sig?.candle_id ?? "").trim();
    })
    .filter(Boolean);
  const candleById = await fetchCatalogCandlesByIds(supabase, candleIds);
  const list = raw.map((r) => toOrderRow(r, candleById));
  const marketIds = [...new Set(list.map((r) => r.market_id).filter(Boolean))];
  const symbolByMarketId = await fetchMarketSymbolsById(supabase, marketIds);
  const executorIds = [...new Set(list.map((r) => r.executor_id).filter(Boolean))];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          model={objectRegistry.registrations.get("orders")!}
          title={parentExecutor ? `Orders Â· ${parentExecutor.name}` : undefined}
          rowCount={list.length}
          sortLine={
            executorIdFilter
              ? `Filtered by executor Â· sorted by created (newest first) Â· Page ${page} of ${pages} Â· ${totalCount} total`
              : `Sorted by created (newest first) Â· Page ${page} of ${pages} Â· ${totalCount} total`
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
            </>
          }
        />
        {error ? <Alert tone="error">{error.message}</Alert> : null}
        {countError ? <Alert tone="error">{countError.message}</Alert> : null}

        <ListViewPagination
          pathname={paginationPathname}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          extraQuery={extraQuery}
        />

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
                    <Th>Pos. side</Th>
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
                    const label =
                      row.market_id && symbolByMarketId.has(row.market_id)
                        ? symbolByMarketId.get(row.market_id)!
                        : row.market_id
                          ? `${row.market_id.slice(0, 8)}â€¦`
                          : "â€”";
                    const ext = row.external_id?.trim() || "â€”";
                    const exName = executorNameById.get(row.executor_id) ?? row.executor_id?.slice(0, 8) + "â€¦";
                    return (
                      <tr key={row.id}>
                        <Td>
                          <Link href={`/orders/${row.id}`} className="bk-link font-mono" title={row.id}>
                            {row.id.slice(0, 8)}â€¦
                          </Link>
                        </Td>
                        <Td>
                          {row.market_id ? (
                            <Link href={`/markets/${row.market_id}`} className="bk-link font-mono">
                              {label}
                            </Link>
                          ) : (
                            <span className="bk-table-muted font-mono">{label}</span>
                          )}
                        </Td>
                        <Td>
                          <Link href={`/executors/${row.executor_id}`} className="bk-link font-mono">
                            {exName}
                          </Link>
                        </Td>
                        <Td className="font-mono">{row.side}</Td>
                        <Td>
                          <PositionSidePill side={row.position_side} />
                        </Td>
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
                            <span title={row.decision_id}>{row.decision_id.slice(0, 8)}â€¦</span>
                          ) : (
                            "â€”"
                          )}
                        </Td>
                        <Td className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</Td>
                      </tr>
                    );
                  })}
                  {!list.length ? (
                    <tr>
                      <Td colSpan={12} muted className="py-8 text-center">
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

        <ListViewPagination
          pathname={paginationPathname}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          extraQuery={extraQuery}
        />
      </div>
    </ListViewLayout>
  );
}
