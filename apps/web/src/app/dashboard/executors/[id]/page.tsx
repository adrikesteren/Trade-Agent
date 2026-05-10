import type { ExecutionModeValue, ExecutorAssetFilterMode } from "@/app/dashboard/executors/actions";
import { ExecutorBalancePanel } from "@/app/dashboard/executors/[id]/executor-balance-panel";
import { fetchSignalsLinkedViaDecisions, formatExecutorSignalSummary } from "@/app/dashboard/executors/[id]/executor-related-load";
import { ExecutorForm, type AssetOption, type ExecutorFormInitial } from "@/app/dashboard/executors/executor-form";
import { RecordDetailTabs } from "@/components/record-detail-tabs";
import {
  DASHBOARD_LIST_VIEW_LIMIT,
  EXECUTOR_LEDGER_FULL_FETCH_CAP,
  RECORD_RELATED_LIST_PREVIEW_ROWS,
} from "@/lib/dashboard/list-view-limit";
import {
  EXECUTOR_DETAIL_TRADE_DECISION_POOL,
  buildTradeDecisionListViewRows,
} from "@/lib/dashboard/trade-decision-list";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { loadExecutorPnlSnapshot } from "@/lib/trading/executor-pnl";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Alert,
  Breadcrumbs,
  Card,
  CardBody,
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordRelatedList,
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

async function marketSymbolMap(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 120) {
    const chunk = uniq.slice(i, i + 120);
    const { data } = await supabase.schema("catalog").from("markets").select("id, market_symbol").in("id", chunk);
    for (const m of data ?? []) {
      const sym = String((m as { id: string; market_symbol?: string | null }).market_symbol ?? "").trim();
      if (sym) map.set(m.id as string, sym);
    }
  }
  return map;
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

type TradeDecisionRow = {
  id: string;
  market_id: string;
  approved: boolean;
  reason_codes: string[] | null;
  close_time: string;
  timeframe: string;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
};

type RiskStateRow = {
  id: string;
  equity_eur: string | number | null;
  open_position_count: number;
  daily_pnl_eur: string | number | null;
  max_drawdown_eur: string | number | null;
  kill_switch: boolean;
  consecutive_losses: number;
  updated_at: string;
};

type PositionRow = {
  id: string;
  market_id: string;
  quantity: string | number | null;
  avg_price: string | number | null;
  paper: boolean;
  updated_at: string;
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

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function resolvedIntentFromRow(row: TradeDecisionRow): string {
  const fromPayload = payloadString(row.decision_payload, "resolvedIntent");
  if (fromPayload) return fromPayload;
  return "—";
}

function intentClassSignal(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT") return "font-medium text-red-700 dark:text-red-400";
  if (intent === "HOLD") return "bk-text-muted";
  return "";
}

function intentClassDecision(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT" || intent === "REDUCE") return "font-medium text-amber-700 dark:text-amber-400";
  if (intent === "HOLD") return "bk-text-muted";
  return "";
}

function approvedClass(approved: boolean): string {
  return approved ? "font-medium text-emerald-700 dark:text-emerald-400" : "bk-text-muted";
}

function formatReasonCodes(codes: string[] | null | undefined): string {
  if (!codes?.length) return "—";
  return codes.join(", ");
}

function orderStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "filled") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (s === "open" || s === "pending") return "font-medium text-amber-700 dark:text-amber-400";
  if (s === "rejected" || s === "cancelled") return "bk-text-muted";
  return "";
}

type ExecutorPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ ledger?: string | string[] }>;
};

export default async function ExecutorDetailPage({ params, searchParams }: ExecutorPageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ledgerParam = sp.ledger;
  const ledgerFull =
    ledgerParam === "all" || ledgerParam === "full" || (Array.isArray(ledgerParam) && ledgerParam.includes("all"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefs = await getUserLocalePreferences();
  const fmtEur = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = (v: string | number | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "—");

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

  const ledgerFetchLimit = ledgerFull ? EXECUTOR_LEDGER_FULL_FETCH_CAP : RECORD_RELATED_LIST_PREVIEW_ROWS;
  const ledgerUiPreviewLimit = ledgerFull ? EXECUTOR_LEDGER_FULL_FETCH_CAP : RECORD_RELATED_LIST_PREVIEW_ROWS;

  const [
    assetOptions,
    pnl,
    rsSingle,
    ledgerPack,
    ordPack,
    tdPack,
    rsListPack,
    posPack,
    signalPack,
  ] = await Promise.all([
    fetchAssetOptions(supabase),
    loadExecutorPnlSnapshot(supabase, { executorId: id, userId: user.id }),
    supabase
      .schema("trading")
      .from("risk_state")
      .select("equity_eur, updated_at")
      .eq("executor_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .schema("trading")
      .from("executor_balance_ledger")
      .select("id, kind, amount_eur, balance_after_eur, note, created_at", { count: "exact" })
      .eq("executor_id", id)
      .order("created_at", { ascending: false })
      .limit(ledgerFetchLimit),
    supabase
      .schema("trading")
      .from("orders")
      .select("id, market_id, side, notional_eur, status, created_at", { count: "exact" })
      .eq("executor_id", id)
      .order("created_at", { ascending: false })
      .limit(DASHBOARD_LIST_VIEW_LIMIT),
    supabase
      .schema("trading")
      .from("trade_decisions")
      .select(
        "id, market_id, approved, reason_codes, close_time, timeframe, decision_payload, created_at",
        { count: "exact" },
      )
      .eq("executor_id", id)
      .order("close_time", { ascending: false })
      .limit(EXECUTOR_DETAIL_TRADE_DECISION_POOL),
    supabase
      .schema("trading")
      .from("risk_state")
      .select(
        "id, equity_eur, open_position_count, daily_pnl_eur, max_drawdown_eur, kill_switch, consecutive_losses, updated_at",
        { count: "exact" },
      )
      .eq("executor_id", id)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(DASHBOARD_LIST_VIEW_LIMIT),
    supabase
      .schema("trading")
      .from("positions")
      .select("id, market_id, quantity, avg_price, paper, updated_at", { count: "exact" })
      .eq("executor_id", id)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(DASHBOARD_LIST_VIEW_LIMIT),
    fetchSignalsLinkedViaDecisions(supabase, id),
  ]);

  const rsRow = rsSingle.data;
  const rsErr = rsSingle.error;

  const { data: ledgerRows, count: ledgerCount, error: lgErr } = ledgerPack;
  const ledger = (ledgerRows ?? []) as LedgerRow[];
  const ledgerTotal = typeof ledgerCount === "number" ? ledgerCount : ledger.length;

  const { data: ordRows, count: orderCount, error: ordErr } = ordPack;
  const orders = (ordRows ?? []) as OrderRow[];
  const orderTotal = typeof orderCount === "number" ? orderCount : orders.length;

  const { data: tdRows, count: tdCount, error: tdErr } = tdPack;
  const tradeDecisionsSorted = buildTradeDecisionListViewRows((tdRows ?? []) as TradeDecisionRow[], 10);
  const tradeDecisionTotal = typeof tdCount === "number" ? tdCount : tradeDecisionsSorted.length;

  const { data: rsListRows, count: rsCount, error: rsListErr } = rsListPack;
  const riskStates = (rsListRows ?? []) as RiskStateRow[];
  const riskStateTotal = typeof rsCount === "number" ? rsCount : riskStates.length;

  const { data: posRows, count: posCount, error: posErr } = posPack;
  const positions = (posRows ?? []) as PositionRow[];
  const positionTotal = typeof posCount === "number" ? posCount : positions.length;

  const { rows: signalRows, error: sigErrMsg } = signalPack;

  const marketIdsForLabels = [
    ...orders.map((o) => o.market_id),
    ...tradeDecisionsSorted.map((d) => d.market_id),
    ...positions.map((p) => p.market_id),
    ...signalRows.map((s) => s.market_id),
  ];
  const symMap = await marketSymbolMap(supabase, marketIdsForLabels);

  const ledgerViewAll = ledgerFull ? undefined : `/dashboard/executors/${id}?ledger=all`;

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg"
      header={
        <div className="bk-stack bk-stack_gap-md">
          <PageHeader
            variant="detail"
            icon={<ListViewObjectIcon letter="E" />}
            breadcrumb={
              <Breadcrumbs items={[{ label: "Executors", href: "/dashboard/executors" }, { label: String(ex.name) }]} />
            }
            back={{ href: "/dashboard/executors", label: "← All executors" }}
            eyebrow="Executor"
            title={String(ex.name)}
            subtitle="Balance, orders, and related activity for this portfolio."
            highlights={
              <>
                <Output label="Enabled" type="boolean" value={ex.enabled} />
                <Output label="Execution mode" type="text" value={String(ex.execution_mode ?? "—")} />
                <Output label="Orders (preview)" type="number" value={orderTotal} />
              </>
            }
            meta={id}
            actions={
              <Link href="/dashboard/executors" className={listViewOutlineActionClass}>
                All executors
              </Link>
            }
          />
          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardBody>
                <p className="bk-text-muted text-xs">Balance (EUR)</p>
                <p className="mt-1 font-mono text-lg">{fmtEur(rsRow?.equity_eur ?? 0)}</p>
                <p className="bk-text-muted mt-2 text-xs">
                  Assigned in this app (Add balance). Buys debit notional plus fee. Not your Bitvavo exchange balance.
                </p>
                <p className="bk-text-muted mt-1 text-xs font-mono">Updated {fmtDt(rsRow?.updated_at ?? null)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="bk-text-muted text-xs">Filled buy notional (EUR)</p>
                <p className="mt-1 font-mono text-lg">{fmtEur(pnl.filledBuyNotionalEur)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="bk-text-muted text-xs">Open cost basis (EUR)</p>
                <p className="mt-1 font-mono text-lg">{fmtEur(pnl.openCostBasisEur)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="bk-text-muted text-xs">Unrealized (mark − cost)</p>
                <p className="mt-1 font-mono text-lg">
                  {pnl.unrealizedEur == null ? "—" : fmtEur(pnl.unrealizedEur)}
                </p>
                <p className="bk-text-muted mt-2 text-xs">Mark uses latest catalog closes per open market.</p>
              </CardBody>
            </Card>
          </div>
          {ledgerFull ? (
            <Alert tone="info">
              Showing expanded balance ledger (newest first, cap {EXECUTOR_LEDGER_FULL_FETCH_CAP} rows).
              {ledgerTotal > ledger.length
                ? ` ${ledgerTotal - ledger.length} older row(s) exist in the database but are not loaded here.`
                : null}{" "}
              <Link href={`/dashboard/executors/${id}`} className="bk-link">
                Back to preview
              </Link>
              .
            </Alert>
          ) : null}
          {ordErr ? <Alert tone="error">{ordErr.message}</Alert> : null}
          {rsErr ? <Alert tone="error">{rsErr.message}</Alert> : null}
          {rsListErr ? <Alert tone="error">{rsListErr.message}</Alert> : null}
          {lgErr ? <Alert tone="error">{lgErr.message}</Alert> : null}
          {tdErr ? <Alert tone="error">{tdErr.message}</Alert> : null}
          {posErr ? <Alert tone="error">{posErr.message}</Alert> : null}
          {sigErrMsg ? <Alert tone="error">{sigErrMsg}</Alert> : null}
        </div>
      }
      content={
        <RecordDetailTabs
          details={
            <div className="bk-stack bk-stack_gap-md">
              <ExecutorForm mode="edit" executorId={id} assetOptions={assetOptions} initial={initial} />
            </div>
          }
          related={
            <Card>
              <CardBody className="bk-stack bk-stack_gap-md !pt-4">
                <RecordRelatedList
                  title="Executor balance ledger"
                  description={
                    ledgerFull && ledgerTotal > ledger.length
                      ? `Sorted by created date (newest first) · loaded ${ledger.length} of ${ledgerTotal} (in-page cap ${EXECUTOR_LEDGER_FULL_FETCH_CAP}).`
                      : ledgerTotal > ledger.length
                        ? `Sorted by created date (newest first) · preview ${ledgerUiPreviewLimit} of ${ledgerTotal}.`
                        : "Sorted by created date (newest first)."
                  }
                  items={ledger}
                  getKey={(r) => r.id}
                  totalCount={ledgerTotal}
                  previewLimit={ledgerUiPreviewLimit}
                  viewAllHref={ledgerViewAll}
                  alwaysShowViewAll={!ledgerFull && Boolean(ledgerViewAll)}
                  emptyMessage="No ledger entries yet. Use Add balance to fund this executor."
                  renderRow={(row) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <span>{ledgerKindLabel(row.kind)}</span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 bk-text-muted" style={{ fontSize: "0.75rem" }}>
                        <span className="font-mono">{fmtEur(row.amount_eur)}</span>
                        <span>after {fmtEur(row.balance_after_eur)}</span>
                        <span className="max-w-[200px] truncate" title={row.note ?? undefined}>
                          {row.note ?? "—"}
                        </span>
                        <span className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</span>
                      </span>
                    </div>
                  )}
                />

                <RecordRelatedList
                  title="Signals"
                  description="Linked via trade decisions for this executor · bar close time desc, then ENTER → EXIT → other."
                  items={signalRows}
                  getKey={(r) => r.id}
                  totalCount={signalRows.length}
                  viewAllHref="/dashboard/signals"
                  emptyMessage="No linked signals yet (no trade decisions with signal_id for this executor)."
                  renderRow={(row) => {
                    const mLabel = symMap.get(row.market_id) ?? row.market_id.slice(0, 8) + "…";
                    const summary = formatExecutorSignalSummary(row, mLabel);
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                        <Link href={`/dashboard/markets/${row.market_id}`} className="bk-link font-mono">
                          {mLabel}
                        </Link>
                        <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                          <span className={intentClassSignal(row.intent)}>{row.intent}</span>
                          {" · "}
                          {summary}
                          {" · "}
                          <span className="whitespace-nowrap font-mono">{fmtDt(row.close_time)}</span>
                        </span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Risk states"
                  description="Risk book rows for this executor."
                  items={riskStates}
                  getKey={(r) => r.id}
                  totalCount={riskStateTotal}
                  viewAllHref={`/dashboard/risk-state?executorId=${encodeURIComponent(id)}`}
                  emptyMessage="No risk state row for this executor."
                  renderRow={(r) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="font-mono">Equity {fmtEur(r.equity_eur)}</span>
                      <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                        Open {r.open_position_count} · daily PnL {fmtEur(r.daily_pnl_eur)} · kill {r.kill_switch ? "on" : "off"}{" "}
                        · updated {fmtDt(r.updated_at)}
                      </span>
                    </div>
                  )}
                />

                <RecordRelatedList
                  title="Trade decisions"
                  description="Approved first · bar close desc · one row per market · preview 10."
                  items={tradeDecisionsSorted}
                  getKey={(r) => r.id}
                  totalCount={tradeDecisionTotal}
                  viewAllHref={`/dashboard/trade-decisions?executorId=${encodeURIComponent(id)}`}
                  emptyMessage="No trade decisions for this executor yet."
                  renderRow={(row) => {
                    const mLabel = symMap.get(row.market_id) ?? row.market_id.slice(0, 8) + "…";
                    const resolved = resolvedIntentFromRow(row);
                    const reasons = formatReasonCodes(row.reason_codes);
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                        <Link href={`/dashboard/markets/${row.market_id}`} className="bk-link font-mono">
                          {mLabel}
                        </Link>
                        <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                          <span className={intentClassDecision(resolved)}>{resolved}</span>
                          {" · "}
                          <span className={approvedClass(row.approved)}>{row.approved ? "approved" : "rejected"}</span>
                          {" · "}
                          {row.timeframe} · <span className="font-mono">{fmtDt(row.close_time)}</span>
                          {reasons !== "—" ? (
                            <>
                              {" · "}
                              <span className="max-w-[12rem] truncate font-mono" title={reasons}>
                                {reasons}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Orders"
                  description="Sorted by created time (newest first)."
                  items={orders}
                  getKey={(o) => o.id}
                  totalCount={orderTotal}
                  viewAllHref={`/dashboard/orders?executorId=${encodeURIComponent(id)}`}
                  emptyMessage="No orders for this executor yet."
                  renderRow={(o) => {
                    const sym = symMap.get(o.market_id) ?? o.market_id.slice(0, 8) + "…";
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`/dashboard/orders/${o.id}`} className="bk-link font-mono" title={o.id}>
                            {o.id.slice(0, 8)}…
                          </Link>
                          <span className="bk-text-muted">·</span>
                          <Link href={`/dashboard/markets/${o.market_id}`} className="bk-link font-mono">
                            {sym}
                          </Link>
                        </span>
                        <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                          <span className="font-mono">{o.side}</span> · {fmtEur(o.notional_eur)} ·{" "}
                          <span className={orderStatusClass(o.status)}>{o.status}</span> ·{" "}
                          <span className="whitespace-nowrap font-mono">{fmtDt(o.created_at)}</span>
                        </span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Positions"
                  description="Sorted by updated date (newest first)."
                  items={positions}
                  getKey={(p) => p.id}
                  totalCount={positionTotal}
                  viewAllHref={`/dashboard/positions?executorId=${encodeURIComponent(id)}`}
                  emptyMessage="No open positions for this executor yet."
                  renderRow={(p) => {
                    const sym = symMap.get(p.market_id) ?? p.market_id.slice(0, 8) + "…";
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                        <Link href={`/dashboard/markets/${p.market_id}`} className="bk-link font-mono">
                          {sym}
                        </Link>
                        <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                          qty {fmtQty(p.quantity)} · avg{" "}
                          {p.avg_price != null && String(p.avg_price).trim() !== "" ? fmtQty(p.avg_price) : "—"} ·{" "}
                          {p.paper ? "paper" : "live"} ·{" "}
                          <span className="whitespace-nowrap font-mono">{fmtDt(p.updated_at)}</span>
                        </span>
                      </div>
                    );
                  }}
                />
              </CardBody>
            </Card>
          }
        />
      }
      sidebar={
        <Card>
          <CardBody className="bk-stack bk-stack_gap-md">
            <p className="bk-text-muted text-sm">Balance & transfers</p>
            <ExecutorBalancePanel executorId={id} />
          </CardBody>
        </Card>
      }
    />
  );
}
