import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { formatUsdMetric, numericOrNegInf } from "@/lib/format-usd-metric";
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
} from "@repo/blocks";
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

/** After global relevance sort, keep the first row per market (that row is “most relevant” for that market). */
function topSignalPerMarket(sorted: SignalRow[]): SignalRow[] {
  const seen = new Set<string>();
  return sorted.filter((row) => {
    if (seen.has(row.market_id)) return false;
    seen.add(row.market_id);
    return true;
  });
}

function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function fmtConfidence(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toFixed(2);
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
      .select("id, market_symbol, assets ( code, coingecko_market_cap_usd )")
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

export default async function SignalsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("signals")
    .select(
      "id, signal_agent_id, market_id, timeframe, close_time, intent, confidence, created_at, metadata, signal_agents ( agent_id )",
    );

  const raw = (rows ?? []) as SignalRow[];
  const marketIds = [...new Set(raw.map((r) => r.market_id))];
  const catalogByMarketId = await fetchCatalogExtrasByMarketId(supabase, marketIds);

  const sorted = [...raw].sort((a, b) => compareSignals(a, b, catalogByMarketId));
  const list = topSignalPerMarket(sorted);

  const sortLineParts = [
    `${list.length} market${list.length === 1 ? "" : "s"}`,
    raw.length > list.length ? `${raw.length} signals in DB` : null,
    "one row per market (top rank)",
    "ENTER → EXIT → other · mcap desc · tie: newest",
  ].filter((s): s is string => Boolean(s));

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Signals"
        iconLetter="S"
        rowCount={list.length}
        sortLine={sortLineParts.join(" · ")}
        uncapped
        actions={
          <>
            <Link href="/dashboard/signal-agents" className={listViewOutlineActionClass}>
              Signal agents
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {raw.length > 0 ? (
        <Alert tone="info">
          One row per market: the highest-ranked signal after the sort below (ENTER → EXIT → other, then mcap,
          then newest). Other bars and agents for the same market stay in{" "}
          <code className="bk-code">trading.signals</code> but are not listed here.
        </Alert>
      ) : null}
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Market</Th>
                  <Th className="text-right">M cap (USD)</Th>
                  <Th>Agent</Th>
                  <Th>TF</Th>
                  <Th>Bar close (UTC)</Th>
                  <Th>Intent</Th>
                  <Th className="text-right">Confidence</Th>
                  <Th>Created (UTC)</Th>
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
                        <Link href={`/dashboard/markets/${row.market_id}`} className="bk-link font-mono">
                          {label}
                        </Link>
                      </Td>
                      <Td className="text-right font-mono">{formatUsdMetric(mcapDisplay)}</Td>
                      <Td className="max-w-[10rem] truncate" title={agentSlug ?? row.signal_agent_id}>
                        <Link href={`/dashboard/signal-agents/${row.signal_agent_id}`} className="bk-link font-mono">
                          {agentSlug ?? row.signal_agent_id.slice(0, 8) + "…"}
                        </Link>
                      </Td>
                      <Td>{row.timeframe}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.close_time)}</Td>
                      <Td>
                        <span className={intentClass(row.intent)}>{row.intent}</span>
                      </Td>
                      <Td className="text-right font-mono">{fmtConfidence(row.confidence)}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.created_at)}</Td>
                    </tr>
                  );
                })}
                {!list.length ? (
                  <tr>
                    <Td colSpan={8} muted className="py-8 text-center">
                      No signals yet. Enable agents under{" "}
                      <Link href="/dashboard/signal-agents" className="bk-link">
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
    </div>
  );
}
