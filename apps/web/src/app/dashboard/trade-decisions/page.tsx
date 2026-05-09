import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
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

type DecisionRow = {
  id: string;
  market_id: string;
  approved: boolean;
  reason_codes: string[] | null;
  close_time: string;
  timeframe: string;
  paper: boolean;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
};

type CatalogMarketRow = {
  id: string;
  market_symbol?: string | null;
};

const MARKET_ID_CHUNK = 120;

function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

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
      console.error("trade-decisions page: markets batch:", error.message);
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

function marketLabel(row: DecisionRow, symbolByMarketId: Map<string, string>): string {
  const fromPayload = payloadString(row.decision_payload, "market_symbol");
  if (fromPayload) return fromPayload;
  return symbolByMarketId.get(row.market_id) ?? row.market_id.slice(0, 8) + "…";
}

export default async function TradeDecisionsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("trade_decisions")
    .select(
      "id, market_id, approved, reason_codes, close_time, timeframe, paper, decision_payload, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (rows ?? []) as DecisionRow[];
  const marketIds = [...new Set(list.map((r) => r.market_id))];
  const symbolByMarketId = await fetchMarketSymbolsById(supabase, marketIds);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Trading Decisions"
        iconLetter="D"
        rowCount={list.length}
        sortLine="Sorted by Created (UTC) · max 200 rows"
        actions={
          <>
            <Link href="/dashboard/signals" className={listViewOutlineActionClass}>
              Signals
            </Link>
            <Link href="/dashboard" className={listViewOutlineActionClass}>
              Dashboard
            </Link>
          </>
        }
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Alert tone="info">
        <strong>CRON_SECRET</strong> is een gedeeld geheim in je server-<code className="bk-code">.env</code>: workers
        zoals candle sync, signals en mediator accepteren alleen requests met een geldige{" "}
        <code className="bk-code">Authorization: Bearer …</code> (jouw geheim) <em>of</em> een geldige QStash-handtekening.
        Zo kan niet iedereen op het internet achtergrondjobs starten.
      </Alert>
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Market</Th>
                  <Th>TF</Th>
                  <Th>Bar close (UTC)</Th>
                  <Th>Resolved</Th>
                  <Th>Approved</Th>
                  <Th>Reason codes</Th>
                  <Th>Paper</Th>
                  <Th>Created (UTC)</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const label = marketLabel(row, symbolByMarketId);
                  const resolved = resolvedIntentFromRow(row);
                  const reasons = formatReasonCodes(row.reason_codes);
                  return (
                    <tr key={row.id}>
                      <Td>
                        <Link href={`/dashboard/markets/${row.market_id}`} className="bk-link font-mono">
                          {label}
                        </Link>
                      </Td>
                      <Td>{row.timeframe}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.close_time)}</Td>
                      <Td>
                        <span className={intentClass(resolved)}>{resolved}</span>
                      </Td>
                      <Td>
                        <span className={approvedClass(row.approved)}>{row.approved ? "yes" : "no"}</span>
                      </Td>
                      <Td className="max-w-[14rem] truncate font-mono" title={reasons}>
                        {reasons}
                      </Td>
                      <Td>{row.paper ? "yes" : "no"}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.created_at)}</Td>
                    </tr>
                  );
                })}
                {!list.length ? (
                  <tr>
                    <Td colSpan={8} muted className="py-8 text-center">
                      No trade decisions yet. After a candle sync produces signals, the mediator worker writes rows
                      here. See{" "}
                      <Link href="/dashboard/signals" className="bk-link">
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
    </div>
  );
}
