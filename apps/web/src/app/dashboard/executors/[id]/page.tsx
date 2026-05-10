import type { ExecutionModeValue, ExecutorAssetFilterMode } from "@/app/dashboard/executors/actions";
import { ExecutorBalancePanel } from "@/app/dashboard/executors/[id]/executor-balance-panel";
import { ExecutorForm, type AssetOption, type ExecutorFormInitial } from "@/app/dashboard/executors/executor-form";
import { DashboardListViewHeader } from "@/components/dashboard-list-view-header";
import { loadExecutorPnlSnapshot } from "@/lib/trading/executor-pnl";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Alert,
  Card,
  CardBody,
  DetailPageLayout,
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

type LedgerRow = {
  id: string;
  kind: string;
  amount_eur: string | number | null;
  balance_after_eur: string | number | null;
  note: string | null;
  created_at: string;
};

function ledgerKindLabel(kind: string): string {
  switch (kind) {
    case "deposit":
      return "Deposit";
    case "withdrawal":
      return "Withdrawal";
    case "trade_buy":
      return "Buy (filled)";
    case "trade_sell":
      return "Sell (filled)";
    default:
      return kind;
  }
}

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
    .select(
      "id, name, enabled, execution_mode, asset_filter_mode, filter_asset_ids, updated_at, default_notional_eur, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (exErr) return <Alert tone="error">{exErr.message}</Alert>;
  if (!ex) notFound();

  const assetOptions = await fetchAssetOptions(supabase);
  const filterIds = (ex.filter_asset_ids as string[] | null) ?? [];

  const extraRaw = ex.mediator_rails_extra as unknown;
  const mediator_rails_extra_json =
    extraRaw != null && typeof extraRaw === "object" ? JSON.stringify(extraRaw, null, 2) : "{}";

  const initial: ExecutorFormInitial = {
    name: String(ex.name ?? ""),
    enabled: Boolean(ex.enabled),
    execution_mode: ex.execution_mode as ExecutionModeValue,
    asset_filter_mode: ex.asset_filter_mode as ExecutorAssetFilterMode,
    filter_asset_ids: filterIds,
    default_notional_eur: String(ex.default_notional_eur ?? "100"),
    max_risk_per_trade: String(ex.max_risk_per_trade ?? "0.05"),
    max_open_positions: String(ex.max_open_positions ?? "5"),
    max_exposure_per_symbol_eur: String(ex.max_exposure_per_symbol_eur ?? "500"),
    daily_loss_limit_eur: String(ex.daily_loss_limit_eur ?? "100"),
    max_drawdown_eur: String(ex.max_drawdown_eur ?? "500"),
    cooldown_after_losses: String(ex.cooldown_after_losses ?? "3"),
    allow_add: Boolean(ex.allow_add),
    mediator_rails_extra_json,
  };

  const pnl = await loadExecutorPnlSnapshot(supabase, { executorId: id, userId: user.id });

  const { data: rsRow, error: rsErr } = await supabase
    .schema("trading")
    .from("risk_state")
    .select("equity_eur, updated_at")
    .eq("executor_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: ledgerRows, error: lgErr } = await supabase
    .schema("trading")
    .from("executor_balance_ledger")
    .select("id, kind, amount_eur, balance_after_eur, note, created_at")
    .eq("executor_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  const ledger = (ledgerRows ?? []) as LedgerRow[];

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
    <DetailPageLayout
      className="bk-container bk-container_lg"
      header={
        <div className="bk-stack bk-stack_gap-md">
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
          {rsErr ? <Alert tone="error">{rsErr.message}</Alert> : null}
          {lgErr ? <Alert tone="error">{lgErr.message}</Alert> : null}
        </div>
      }
      content={
        <div className="bk-stack bk-stack_gap-md">
          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardBody>
                <p className="bk-text-muted text-xs">Balance (EUR)</p>
                <p className="mt-1 font-mono text-lg">{fmtNum(rsRow?.equity_eur ?? 0, 2)}</p>
                <p className="bk-text-muted mt-2 text-xs">
                  Assigned in this app (Add balance). Buys debit notional plus fee. Not your Bitvavo exchange balance.
                </p>
                <p className="bk-text-muted mt-1 text-xs font-mono">
                  Updated {rsRow?.updated_at ? String(rsRow.updated_at).slice(0, 19).replace("T", " ") + " UTC" : "—"}
                </p>
              </CardBody>
            </Card>
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
                <p className="bk-text-muted mt-2 text-xs">Mark uses latest catalog closes per open market.</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody className="bk-stack bk-stack_gap-md">
              <p className="bk-text-muted text-sm">Balance & transfers</p>
              <ExecutorBalancePanel executorId={id} />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="!pt-0">
              <p className="bk-text-muted mb-2 text-sm">Activity (ledger)</p>
              <TableWrap>
                <Table className="text-xs">
                  <thead>
                    <tr>
                      <Th>Type</Th>
                      <Th className="text-right">Amount (EUR)</Th>
                      <Th className="text-right">Balance after</Th>
                      <Th>Note</Th>
                      <Th>Time (UTC)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((row) => (
                      <tr key={row.id}>
                        <Td>{ledgerKindLabel(row.kind)}</Td>
                        <Td className="text-right font-mono">{fmtNum(row.amount_eur, 2)}</Td>
                        <Td className="text-right font-mono">{fmtNum(row.balance_after_eur, 2)}</Td>
                        <Td className="max-w-[200px] truncate">{row.note ?? "—"}</Td>
                        <Td className="whitespace-nowrap font-mono">
                          {String(row.created_at).slice(0, 19).replace("T", " ")}
                        </Td>
                      </tr>
                    ))}
                    {!ledger.length ? (
                      <tr>
                        <Td colSpan={5} muted className="py-6 text-center">
                          No ledger entries yet. Use Add balance to fund this executor.
                        </Td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
              </TableWrap>
            </CardBody>
          </Card>

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
      }
    />
  );
}
