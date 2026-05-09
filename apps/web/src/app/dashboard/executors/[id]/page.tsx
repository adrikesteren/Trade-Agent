import type { ExecutionModeValue, ExecutorAssetFilterMode } from "@/app/dashboard/executors/actions";
import { ExecutorForm, type AssetOption, type ExecutorFormInitial } from "@/app/dashboard/executors/executor-form";
import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { loadExecutorPnlSnapshot } from "@/lib/trading/executor-pnl";
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
import { notFound, redirect } from "next/navigation";

async function fetchAssetOptions(supabase: SupabaseClient): Promise<AssetOption[]> {
  const { data, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .order("code", { ascending: true })
    .limit(400);
  if (error) {
    console.error("assets list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string }[]).map((a) => ({ id: a.id, code: a.code }));
}

type OrderRow = {
  id: string;
  market_id: string;
  side: string;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
};

function fmtNum(v: string | number | null | undefined, decimals: number): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export default async function ExecutorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ex, error: exErr } = await supabase
    .schema("trading")
    .from("executors")
    .select("id, name, enabled, execution_mode, budget_eur, asset_filter_mode, filter_asset_ids, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (exErr) return <Alert tone="error">{exErr.message}</Alert>;
  if (!ex) notFound();

  const assetOptions = await fetchAssetOptions(supabase);
  const filterIds = (ex.filter_asset_ids as string[] | null) ?? [];

  const initial: ExecutorFormInitial = {
    name: String(ex.name ?? ""),
    enabled: Boolean(ex.enabled),
    execution_mode: ex.execution_mode as ExecutionModeValue,
    budget_eur: ex.budget_eur != null ? String(ex.budget_eur) : null,
    asset_filter_mode: ex.asset_filter_mode as ExecutorAssetFilterMode,
    filter_asset_ids: filterIds,
  };

  const pnl = await loadExecutorPnlSnapshot(supabase, { executorId: id, userId: user.id });

  const { data: ordRows, error: ordErr } = await supabase
    .schema("trading")
    .from("orders")
    .select("id, market_id, side, notional_eur, status, created_at")
    .eq("executor_id", id)
    .order("created_at", { ascending: false })
    .limit(40);

  const orders = (ordRows ?? []) as OrderRow[];
  const marketIds = [...new Set(orders.map((o) => o.market_id))];
  const symMap = new Map<string, string>();
  if (marketIds.length) {
    const { data: mkts } = await supabase.schema("catalog").from("markets").select("id, market_symbol").in("id", marketIds);
    for (const m of mkts ?? []) {
      symMap.set(m.id as string, String(m.market_symbol ?? ""));
    }
  }

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <DashboardListViewHeader
        eyebrow="Trading"
        title={String(ex.name)}
        iconLetter="E"
        rowCount={orders.length}
        sortLine="Executor portfolio"
        actions={
          <Link href="/dashboard/executors" className={listViewOutlineActionClass}>
            All executors
          </Link>
        }
      />
      {ordErr ? <Alert tone="error">{ordErr.message}</Alert> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardBody>
            <p className="bk-text-muted text-xs">Filled buy notional (EUR)</p>
            <p className="mt-1 font-mono text-lg">{fmtNum(pnl.filledBuyNotionalEur, 2)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="bk-text-muted text-xs">Open cost basis (EUR)</p>
            <p className="mt-1 font-mono text-lg">{fmtNum(pnl.openCostBasisEur, 2)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="bk-text-muted text-xs">Unrealized (mark − cost)</p>
            <p className="mt-1 font-mono text-lg">
              {pnl.unrealizedEur == null ? "—" : fmtNum(pnl.unrealizedEur, 2)}
            </p>
            <p className="bk-text-muted mt-2 text-xs">
              Mark uses latest catalog closes per open market. Risk rails remain user-global (v1).
            </p>
          </CardBody>
        </Card>
      </div>

      <ExecutorForm mode="edit" executorId={id} assetOptions={assetOptions} initial={initial} />

      <Card>
        <CardBody className="!pt-0">
          <p className="bk-text-muted mb-2 text-sm">Recent orders (this executor)</p>
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Market</Th>
                  <Th>Side</Th>
                  <Th className="text-right">Notional (EUR)</Th>
                  <Th>Status</Th>
                  <Th>Created (UTC)</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const sym = symMap.get(o.market_id) ?? o.market_id.slice(0, 8) + "…";
                  return (
                    <tr key={o.id}>
                      <Td className="font-mono">
                        <Link href={`/dashboard/markets/${o.market_id}`} className="bk-link">
                          {sym}
                        </Link>
                      </Td>
                      <Td className="font-mono">{o.side}</Td>
                      <Td className="text-right font-mono">{fmtNum(o.notional_eur, 2)}</Td>
                      <Td>{o.status}</Td>
                      <Td className="whitespace-nowrap font-mono">{String(o.created_at).slice(0, 19).replace("T", " ")}</Td>
                    </tr>
                  );
                })}
                {!orders.length ? (
                  <tr>
                    <Td colSpan={5} muted className="py-6 text-center">
                      No orders for this executor yet.
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
