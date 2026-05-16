import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { PositionSidePill } from "@/components/position-side-pill";
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
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as DecisionsSelector from "@/lib/selectors/decisions-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
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

type DecisionRow = {
  id: string;
  executor_id: string;
  signal_id: string;
  market_id: string;
  approved: boolean;
  reason_codes: string[] | null;
  close_time: string;
  timeframe: string;
  position_side: string;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
};

type DecisionRowDb = Omit<DecisionRow, "market_id" | "close_time"> & {
  signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
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
  return "â€”";
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
  if (!codes?.length) return "â€”";
  return codes.join(", ");
}

function unwrapOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function normalizeTradeDecisionRow(r: DecisionRowDb, candleById: Map<string, CatalogCandleBar>): DecisionRow {
  const { signals: _sig, ...base } = r;
  const p = base.decision_payload;
  const barFromPayload =
    p && typeof p === "object" && typeof (p as Record<string, unknown>).barCloseTimeIso === "string"
      ? String((p as Record<string, unknown>).barCloseTimeIso).trim()
      : "";
  const sig = unwrapOne(r.signals);
  const cid = String(sig?.candle_id ?? "").trim();
  const candle = cid ? candleById.get(cid) : undefined;
  const closeFromCandle = candle?.close_time ? candle.close_time.trim() : "";
  const marketId = candle?.market_id ? candle.market_id.trim() : "";
  return {
    id: base.id,
    executor_id: base.executor_id,
    signal_id: base.signal_id,
    market_id: marketId,
    approved: base.approved,
    reason_codes: base.reason_codes,
    timeframe: base.timeframe,
    position_side: String((base as { position_side?: string | null }).position_side ?? "long"),
    decision_payload: base.decision_payload,
    created_at: base.created_at,
    close_time: barFromPayload || closeFromCandle || base.created_at,
  };
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
    try {
      const batch = await MarketsSelector.selectIdAndSymbolByIds(supabase, chunk);
      rows.push(...(batch as CatalogMarketRow[]));
    } catch (e) {
      console.error("trade-decisions list: markets batch:", e instanceof Error ? e.message : String(e));
      continue;
    }
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
    let rows: Awaited<ReturnType<typeof ExecutorsSelector.selectIdAndNameByIds>>;
    try {
      rows = await ExecutorsSelector.selectIdAndNameByIds(supabase, chunk);
    } catch (e) {
      console.error("trade-decisions list: executors batch:", e instanceof Error ? e.message : String(e));
      continue;
    }
    for (const e of rows) {
      map.set(e.id, String(e.name ?? "").trim() || e.id);
    }
  }
  return map;
}

function marketLabel(row: DecisionRow, symbolByMarketId: Map<string, string>): string {
  const fromPayload = payloadString(row.decision_payload, "market_symbol");
  if (fromPayload) return fromPayload;
  if (!row.market_id) return "â€”";
  return symbolByMarketId.get(row.market_id) ?? `${row.market_id.slice(0, 8)}â€¦`;
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
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "â€”");

  let rows: DecisionsSelector.DecisionListViewRow[] | null = null;
  let error: { message: string } | null = null;
  try {
    rows = await DecisionsSelector.selectListViewRecent(supabase, {
      limit: TRADE_DECISIONS_FETCH_POOL,
      executorIdFilter,
    });
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  const rawDb = (rows ?? []) as DecisionRowDb[];
  const candleIds = rawDb
    .map((r) => String(unwrapOne(r.signals)?.candle_id ?? "").trim())
    .filter(Boolean);
  const candleById = await fetchCatalogCandlesByIds(supabase, candleIds);
  const raw = rawDb.map((r) => normalizeTradeDecisionRow(r, candleById));
  const deduped = dedupeTradeDecisionsForListView(raw);
  const totalCount = deduped.length;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);
  const list = deduped.slice(from, to + 1);

  const marketIds = [...new Set(list.map((r) => r.market_id).filter(Boolean))];
  const symbolByMarketId = await fetchMarketSymbolsById(supabase, marketIds);
  const executorIds = [...new Set(list.map((r) => r.executor_id).filter(Boolean))];
  const executorNameById = await fetchExecutorNamesById(supabase, executorIds);

  const sortLineCore = `Approved first Â· bar close desc Â· one row per market Â· ${totalCount} ranked from last ${TRADE_DECISIONS_FETCH_POOL} rows Â· Page ${page} of ${pages}`;

  const extraQuery: Record<string, string | undefined> = {};
  if (executorIdFilter) extraQuery.executorId = executorIdFilter;

  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
        <ObjectListViewHeader
          model={objectRegistry.registrations.get("trade_decisions")!}
          title={parentExecutor ? `Trading decisions Â· ${parentExecutor.name}` : undefined}
          rowCount={list.length}
          sortLine={executorIdFilter ? `Filtered by executor Â· ${sortLineCore}` : sortLineCore}
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
            <code className="bk-code">Authorization: Bearer â€¦</code> (jouw <code className="bk-code">CRON_SECRET</code>).
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
                    <Th>Pos. side</Th>
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
                    const exName = executorNameById.get(row.executor_id) ?? row.executor_id?.slice(0, 8) + "â€¦";
                    return (
                      <tr key={row.id}>
                        <Td>
                          <Link href={`/trade-decisions/${row.id}`} className="bk-link font-mono" title={row.id}>
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
                        <Td>{row.timeframe}</Td>
                        <Td className="whitespace-nowrap font-mono">{fmtDt(row.close_time)}</Td>
                        <Td>
                          <span className={intentClass(resolved)}>{resolved}</span>
                        </Td>
                        <Td>
                          <PositionSidePill side={row.position_side} />
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
                      <Td colSpan={10} muted className="py-8 text-center">
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
