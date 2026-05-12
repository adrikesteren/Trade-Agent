import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT } from "@/lib/dashboard/list-view-limit";
import {
  TRADE_DECISIONS_FETCH_POOL,
  dedupeTradeDecisionsForListView,
} from "@/lib/dashboard/trade-decision-list";
import {
  clampPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatDatetime } from "@/lib/locale/format";
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

type DecisionRow = {
  id: string;
  executor_id: string;
  market_id: string;
  approved: boolean;
  reason_codes: string[] | null;
  close_time: string;
  timeframe: string;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
};

type CatalogMarketRow = {
  id: string;
  market_symbol?: string | null;
};

const MARKET_ID_CHUNK = 120;

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function resolvedIntentFromRow(row: DecisionRow): string {
  const fromPayload = payloadString(row.decision_payload, "resolvedIntent");
  if (fromPayload) return fromPayload;
  return "—";
}

function intentClass(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT" || intent === "REDUCE") return "font-medium text-amber-700 dark:text-amber-400";
  if (intent === "HOLD") return "bk-table-muted";
  return "";
}

function approvedClass(approved: boolean): string {
  return approved
    ? "font-medium text-emerald-700 dark:text-emerald-400"
    : "bk-table-muted";
}

function formatReasonCodes(codes: string[] | null | undefined): string {
  if (!codes?.length) return "—";
  return codes.join(", ");
}

async function fetchMarketSymbolsById(
  supabase: SupabaseClient,
  marketIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (marketIds.length === 0) return map;

  const rows: CatalogMarketRow[] = [];
  for (let i = 0; i < marketIds.length; i += MARKET_ID_CHUNK) {
    const chunk = marketIds.slice(i, i + MARKET_ID_CHUNK);
    const { data, error } = await supabase.schema("catalog").from("markets").select("id, market_symbol").in("id", chunk);
    if (error) {
      console.error("trade-decisions list: markets batch:", error.message);
      continue;
    }
    rows.push(...((data ?? []) as CatalogMarketRow[]));
  }

  for (const m of rows) {
    const sym = String(m.market_symbol ?? "").trim();
    if (sym) map.set(m.id, sym);
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
      console.error("trade-decisions list: executors batch:", error.message);
      continue;
    }
    for (const e of data ?? []) {
      map.set(e.id as string, String(e.name ?? "").trim() || (e.id as string));
    }
  }
  return map;
}

function marketLabel(row: DecisionRow, symbolByMarketId: Map<string, string>): string {
  const fromPayload = payloadString(row.decision_payload, "market_symbol");
  if (fromPayload) return fromPayload;
  return symbolByMarketId.get(row.market_id) ?? row.market_id.slice(0, 8) + "…";
}

export type TradeDecisionsListViewProps = {
  executorIdFilter: string | null;
  parentExecutor?: { id: string; name: string };
  /** When false, omits the CRON_SECRET explainer (used on nested executor routes). */
  showCronBanner?: boolean;
  paginationPathname: string;
  page: number;
};

export async function TradeDecisionsListView({
  executorIdFilter,
  parentExecutor,
  showCronBanner = true,
  paginationPathname,
  page: pageRaw,
}: TradeDecisionsListViewProps) {
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "—");

  let q = supabase
    .schema("trading")
    .from("trade_decisions")
    .select(
      "id, executor_id, market_id, approved, reason_codes, close_time, timeframe, decision_payload, created_at",
    )
    .order("close_time", { ascending: false })
    .limit(TRADE_DECISIONS_FETCH_POOL);
  if (executorIdFilter) {
    q = q.eq("executor_id", executorIdFilter);
  }
  const { data: rows, error } = await q;

  const raw = (rows ?? []) as DecisionRow[];
  const deduped = dedupeTradeDecisionsForListView(raw);
  const totalCount = deduped.length;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);
  const list = deduped.slice(from, to + 1);

  const marketIds = [...new Set(list.map((r) => r.market_id))];
  const symbolByMarketId = await fetchMarketSymbolsById(supabase, marketIds);
  const executorIds = [...new Set(list.map((r) => r.executor_id).filter(Boolean))];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  const sortLineCore = `Approved first · bar close desc · one row per market · ${totalCount} ranked from last ${TRADE_DECISIONS_FETCH_POOL} rows · Page ${page} of ${pages}`;

  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          eyebrow={parentExecutor ? "Executor · related" : "Trading"}
          title={parentExecutor ? `Trading decisions · ${parentExecutor.name}` : "Trading Decisions"}
          iconLetter="D"
          rowCount={list.length}
          sortLine={executorIdFilter ? `Filtered by executor · ${sortLineCore}` : sortLineCore}
          actions={
            <>
              {parentExecutor ? (
                <Link href={`/executors/${parentExecutor.id}`} className={listViewOutlineActionClass}>
                  Executor
                </Link>
              ) : null}
              <Link href="/signals" className={listViewOutlineActionClass}>
                Signals
              </Link>
            </>
          }
        />
        {error ? <Alert tone="error">{error.message}</Alert> : null}
        {showCronBanner ? (
          <Alert tone="info">
            <strong>CRON_SECRET</strong> is een gedeeld geheim in je server-<code className="bk-code">.env</code>: workers
            zoals candle sync, signals en mediator accepteren alleen requests met een geldige{" "}
            <code className="bk-code">Authorization: Bearer …</code> (jouw <code className="bk-code">CRON_SECRET</code>).
            Zo kan niet iedereen op het internet achtergrondjobs starten.
          </Alert>
        ) : null}

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
                    <Th>Decision</Th>
                    <Th>Market</Th>
                    <Th>Executor</Th>
                    <Th>TF</Th>
                    <Th>Bar close</Th>
                    <Th>Resolved</Th>
                    <Th>Approved</Th>
                    <Th>Reason codes</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const label = marketLabel(row, symbolByMarketId);
                    const resolved = resolvedIntentFromRow(row);
                    const reasons = formatReasonCodes(row.reason_codes);
                    const exName = executorNameById.get(row.executor_id) ?? row.executor_id?.slice(0, 8) + "…";
                    return (
                      <tr key={row.id}>
                        <Td>
                          <Link href={`/trade-decisions/${row.id}`} className="bk-link font-mono" title={row.id}>
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
                        <Td>{row.timeframe}</Td>
                        <Td className="whitespace-nowrap font-mono">{fmtDt(row.close_time)}</Td>
                        <Td>
                          <span className={intentClass(resolved)}>{resolved}</span>
                        </Td>
                        <Td>
                          <span className={approvedClass(row.approved)}>{row.approved ? "yes" : "no"}</span>
                        </Td>
                        <Td className="max-w-[14rem] truncate font-mono" title={reasons}>
                          {reasons}
                        </Td>
                        <Td className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</Td>
                      </tr>
                    );
                  })}
                  {!list.length ? (
                    <tr>
                      <Td colSpan={9} muted className="py-8 text-center">
                        No trade decisions yet. After a candle sync produces signals, the mediator worker writes rows
                        here. See{" "}
                        <Link href="/signals" className="bk-link">
                          Signals
                        </Link>{" "}
                        and the <span className="font-mono">Trade mediator</span> section in{" "}
                        <code className="bk-code">apps/web/README.md</code>.
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
