import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { ListViewPagination } from "@/components/list-view-pagination";
import { DASHBOARD_LIST_VIEW_LIMIT, SIGNALS_LIST_RAW_FETCH_CAP } from "@/lib/dashboard/list-view-limit";
import {
  clampPage,
  parseListPage,
  rangeForPage,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import { formatUsdMetric, numericOrNegInf } from "@/lib/format-usd-metric";
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Alert,
  Card,
  CardBody,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/adricore/blocks";
import Link from "next/link";

type SignalRow = {
  id: string;
  signal_agent_id: string;
  market_id: string;
  timeframe: string;
  close_time: string;
  intent: string;
  confidence: number | string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

type SignalRowRaw = Omit<SignalRow, "market_id" | "timeframe" | "close_time"> & {
  candle_id: string;
};

function normalizeSignalRow(r: SignalRowRaw, candleById: Map<string, CatalogCandleBar>): SignalRow {
  const cid = String(r.candle_id ?? "").trim();
  const candle = cid ? candleById.get(cid) : undefined;
  const close_time =
    candle?.close_time && candle.close_time.trim() ? candle.close_time.trim() : r.created_at;
  const market_id = candle?.market_id ? candle.market_id.trim() : "";
  const timeframe = candle?.timeframe ? candle.timeframe.trim() || "—" : "—";
  return {
    id: r.id,
    signal_agent_id: r.signal_agent_id,
    market_id,
    timeframe,
    close_time,
    intent: r.intent,
    confidence: r.confidence,
    created_at: r.created_at,
    metadata: r.metadata,
    signal_agents: r.signal_agents,
  };
}

type CatalogMarketRow = {
  id: string;
  market_symbol?: string | null;
  assets?: unknown;
};

type MarketCatalogExtra = {
  /** `catalog.markets.market_symbol` (e.g. BTC-EUR) */
  marketSymbol: string;
  /** `catalog.assets.code` when market_symbol is empty */
  assetCode: string;
  mcapN: number;
};

const MARKET_ID_IN_CHUNK = 120;

function agentSlugFromSignalRow(row: SignalRow): string | null {
  const rel = row.signal_agents;
  if (!rel) return null;
  const first = Array.isArray(rel) ? rel[0] : rel;
  return first?.agent_id ?? null;
}

function marketSymbolFromMetadata(row: SignalRow): string | null {
  const m = row.metadata;
  if (!m || typeof m !== "object") return null;
  const sym = m.market_symbol;
  return typeof sym === "string" && sym.trim() ? sym.trim() : null;
}

function parseAssetFromMarketRow(m: CatalogMarketRow): {
  code: string;
  mcapN: number;
} {
  const rawA = m.assets as unknown;
  const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as {
    code?: string | null;
    coingecko_market_cap_usd?: number | string | null;
  } | null;
  const code = String(asset?.code ?? "").trim();
  return {
    code,
    mcapN: numericOrNegInf(asset?.coingecko_market_cap_usd ?? null),
  };
}

function mcapFromExtras(marketId: string, catalogByMarketId: Map<string, MarketCatalogExtra>): number {
  return catalogByMarketId.get(marketId)?.mcapN ?? Number.NEGATIVE_INFINITY;
}

/** Label: market table symbol first, then base asset code from the same row, then worker metadata, then id. */
function resolveMarketLabel(row: SignalRow, catalogByMarketId: Map<string, MarketCatalogExtra>): string {
  if (!row.market_id) {
    const meta = marketSymbolFromMetadata(row);
    if (meta) return meta;
    return row.id.slice(0, 8) + "…";
  }
  const c = catalogByMarketId.get(row.market_id);
  if (c?.marketSymbol) return c.marketSymbol;
  if (c?.assetCode) return c.assetCode;
  const meta = marketSymbolFromMetadata(row);
  if (meta) return meta;
  return row.market_id.slice(0, 8) + "…";
}

/** ENTER first, EXIT second, all other intents last (each block sorted by mcap desc, then newest). */
function intentSortGroup(intent: string): number {
  if (intent === "ENTER") return 0;
  if (intent === "EXIT") return 1;
  return 2;
}

function compareSignals(
  a: SignalRow,
  b: SignalRow,
  catalogByMarketId: Map<string, MarketCatalogExtra>,
): number {
  const g = intentSortGroup(a.intent) - intentSortGroup(b.intent);
  if (g !== 0) return g;
  const mc = mcapFromExtras(b.market_id, catalogByMarketId) - mcapFromExtras(a.market_id, catalogByMarketId);
  if (mc !== 0) return mc;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/** After global relevance sort, keep the first row per (market, agent) — top-ranked signal per agent per market. */
function topSignalPerMarketAndAgent(sorted: SignalRow[]): SignalRow[] {
  const seen = new Set<string>();
  return sorted.filter((row) => {
    const key = `${row.market_id}::${row.signal_agent_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function intentClass(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT") return "font-medium text-red-700 dark:text-red-400";
  if (intent === "HOLD") return "bk-table-muted";
  return "";
}

async function fetchCatalogExtrasByMarketId(
  supabase: SupabaseClient,
  marketIds: string[],
): Promise<Map<string, MarketCatalogExtra>> {
  const catalogByMarketId = new Map<string, MarketCatalogExtra>();
  if (marketIds.length === 0) return catalogByMarketId;

  const rows: CatalogMarketRow[] = [];
  for (let i = 0; i < marketIds.length; i += MARKET_ID_IN_CHUNK) {
    const chunk = marketIds.slice(i, i + MARKET_ID_IN_CHUNK);
    const { data, error } = await supabase
      .schema("catalog")
      .from("markets")
      .select("id, market_symbol, assets!markets_asset_id_fkey ( code, coingecko_market_cap_usd )")
      .in("id", chunk);
    if (error) {
      console.error("signals page: markets batch:", error.message);
      continue;
    }
    rows.push(...((data ?? []) as CatalogMarketRow[]));
  }

  for (const m of rows) {
    const id = m.id as string;
    const { code, mcapN } = parseAssetFromMarketRow(m);
    const marketSymbol = String(m.market_symbol ?? "").trim();
    catalogByMarketId.set(id, {
      marketSymbol,
      assetCode: code,
      mcapN,
    });
  }

  return catalogByMarketId;
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const pageRaw = parseListPage(sp);
  const pageSize = DASHBOARD_LIST_VIEW_LIMIT;
  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "—");
  const fmtConfidence = (v: number | string | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, candle_id, intent, confidence, created_at, metadata, signal_agents ( agent_id )",
    )
    .order("created_at", { ascending: false })
    .limit(SIGNALS_LIST_RAW_FETCH_CAP);

  const rawDb = (rows ?? []) as SignalRowRaw[];
  const candleIds = rawDb.map((r) => String(r.candle_id ?? "").trim()).filter(Boolean);
  const candleById = await fetchCatalogCandlesByIds(supabase, candleIds);
  const raw = rawDb.map((r) => normalizeSignalRow(r, candleById));
  const marketIds = [...new Set(raw.map((r) => r.market_id))];
  const catalogByMarketId = await fetchCatalogExtrasByMarketId(supabase, marketIds);

  const sorted = [...raw].sort((a, b) => compareSignals(a, b, catalogByMarketId));
  const ranked = topSignalPerMarketAndAgent(sorted);
  const totalCount = ranked.length;
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const { from, to } = rangeForPage(page, pageSize);
  const list = ranked.slice(from, to + 1);

  const sortLineParts = [
    `${list.length} on this page`,
    `${totalCount} ranked rows`,
    `Page ${page} of ${pages}`,
    raw.length !== ranked.length ? `${raw.length} signals loaded` : null,
    "one row per market + agent (top rank each)",
    "ENTER → EXIT → other · mcap desc · tie: newest",
    `${pageSize} per page`,
  ].filter((s): s is string => Boolean(s));

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        eyebrow="Trading"
        title="Signals"
        iconLetter="S"
        rowCount={list.length}
        sortLine={sortLineParts.join(" · ")}
        actions={
          <Link href="/signal-agents" className={listViewOutlineActionClass}>
            Signal agents
          </Link>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {raw.length > 0 ? (
        <Alert tone="info">
          One row per market and signal agent: for each pair we show the highest-ranked signal after the sort below
          (ENTER → EXIT → other, then mcap, then newest). Other bars for the same market+agent stay in{" "}
          <code className="bk-code">trading.signals</code> but are not listed here.
        </Alert>
      ) : null}
      <ListViewPagination pathname="/signals" page={page} pageSize={pageSize} totalCount={totalCount} />
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Signal</Th>
                  <Th>Market</Th>
                  <Th className="text-right">M cap (USD)</Th>
                  <Th>Agent</Th>
                  <Th>TF</Th>
                  <Th>Bar close</Th>
                  <Th>Intent</Th>
                  <Th className="text-right">Confidence</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const label = resolveMarketLabel(row, catalogByMarketId);
                  const agentSlug = agentSlugFromSignalRow(row);
                  const mcapN = mcapFromExtras(row.market_id, catalogByMarketId);
                  const mcapDisplay = Number.isFinite(mcapN) ? mcapN : null;
                  return (
                    <tr key={row.id}>
                      <Td>
                        <Link href={`/signals/${row.id}`} className="bk-link font-mono" title={row.id}>
                          {row.id.slice(0, 8)}…
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
                      <Td className="text-right font-mono">{formatUsdMetric(mcapDisplay, prefs)}</Td>
                      <Td className="max-w-[10rem] truncate" title={agentSlug ?? row.signal_agent_id}>
                        <Link href={`/signal-agents/${row.signal_agent_id}`} className="bk-link font-mono">
                          {agentSlug ?? row.signal_agent_id.slice(0, 8) + "…"}
                        </Link>
                      </Td>
                      <Td>{row.timeframe}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtDt(row.close_time)}</Td>
                      <Td>
                        <span className={intentClass(row.intent)}>{row.intent}</span>
                      </Td>
                      <Td className="text-right font-mono">{fmtConfidence(row.confidence)}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</Td>
                    </tr>
                  );
                })}
                {!list.length ? (
                  <tr>
                    <Td colSpan={9} muted className="py-8 text-center">
                      No signals yet. Enable agents under{" "}
                      <Link href="/signal-agents" className="bk-link">
                        Signal agents
                      </Link>{" "}
                      and run a candle sync so the worker can populate this list.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
      <ListViewPagination pathname="/signals" page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
