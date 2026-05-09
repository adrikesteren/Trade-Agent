import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
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
} from "@repo/blocks";
import Link from "next/link";

type SignalRow = {
  id: string;
  agent_id: string;
  market_id: string;
  timeframe: string;
  close_time: string;
  intent: string;
  confidence: number | string | null;
  created_at: string;
};

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

export default async function SignalsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("trading")
    .from("signals")
    .select("id, agent_id, market_id, timeframe, close_time, intent, confidence, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (rows ?? []) as SignalRow[];
  const marketIds = [...new Set(list.map((r) => r.market_id))];

  const symbolById = new Map<string, string>();
  if (marketIds.length > 0) {
    const { data: mkts } = await supabase
      .schema("catalog")
      .from("markets")
      .select("id, market_symbol")
      .in("id", marketIds);
    for (const m of mkts ?? []) {
      symbolById.set(m.id as string, m.market_symbol as string);
    }
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title="Signals"
        iconLetter="S"
        rowCount={list.length}
        sortLine="Sorted by Created date"
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
      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Market</Th>
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
                  const sym = symbolById.get(row.market_id);
                  return (
                    <tr key={row.id}>
                      <Td>
                        <Link href={`/dashboard/markets/${row.market_id}`} className="bk-link font-mono">
                          {sym ?? row.market_id.slice(0, 8) + "…"}
                        </Link>
                      </Td>
                      <Td className="max-w-[10rem] truncate" title={row.agent_id}>
                        {row.agent_id}
                      </Td>
                      <Td>{row.timeframe}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.close_time)}</Td>
                      <Td>
                        <span
                          className={
                            row.intent === "ENTER"
                              ? "font-medium text-emerald-700 dark:text-emerald-400"
                              : row.intent === "HOLD"
                                ? "bk-table-muted"
                                : ""
                          }
                        >
                          {row.intent}
                        </span>
                      </Td>
                      <Td className="text-right font-mono">{fmtConfidence(row.confidence)}</Td>
                      <Td className="whitespace-nowrap font-mono">{fmtUtc(row.created_at)}</Td>
                    </tr>
                  );
                })}
                {!list.length ? (
                  <tr>
                    <Td colSpan={7} muted className="py-8 text-center">
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
