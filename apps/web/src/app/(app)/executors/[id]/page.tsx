import type { ExecutorAssetFilterMode } from "@/app/(app)/executors/actions";
import { ExecutorDetailBalanceActions } from "@/app/(app)/executors/[id]/executor-detail-balance-actions";
import { ExecutorHistoricalRunHeaderAction } from "@/app/(app)/executors/[id]/executor-historical-run-header-action";
import { ExecutorEditDialog } from "@/app/(app)/executors/[id]/executor-edit-dialog";
import { ExecutorQuoteBudgetCreateDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-create-dialog";
import { ExecutorQuoteBudgetDeleteDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-delete-dialog";
import { ExecutorQuoteBudgetEditDialog } from "@/app/(app)/executors/[id]/executor-quote-budget-edit-dialog";
import type { AssetOption, ExchangeOption, ExecutorQuoteBudgetInitial } from "@/app/(app)/executors/executor-form";
import { executorRowToFormInitial } from "@/app/(app)/executors/executor-row-to-form-initial";
import { fetchQuoteAssetOptionsByExchange } from "@/app/(app)/executors/quote-asset-options";
import { fetchExchangeCapabilitiesById } from "@/app/(app)/executors/exchange-capabilities";
import { RecordPageTabs } from "@/components/record-page-tabs";
import { RecordTasksRelatedCard } from "@/components/record-tasks-related-card";
import {
  DASHBOARD_LIST_VIEW_LIMIT,
  EXECUTOR_LEDGER_FULL_FETCH_CAP,
  RECORD_RELATED_LIST_PREVIEW_ROWS,
} from "@/lib/dashboard/list-view-limit";
import { EXECUTOR_DETAIL_TRADE_DECISION_POOL } from "@/lib/dashboard/trade-decision-list";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { fetchCatalogCandlesByIds, type CatalogCandleBar } from "@/lib/catalog/fetch-candles-by-ids";
import { valueInPrimaryUnits } from "@/lib/catalog/asset-dollar-value";
import { loadExecutorPnlSnapshot } from "@/lib/agents/executor/services/executor-pnl.service";
import { fetchWalletBalanceForAsset } from "@/lib/agents/executor/services/executor-wallet.service";
import { fetchHistoricalExecutorPaperMarket } from "@/lib/agents/executor/services/historical-paper-market.service";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Alert,
  Card,
  CardBody,
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
  RecordRelatedList,
  listViewOutlineActionClass,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

async function fetchAssetOptions(supabase: SupabaseClient): Promise<AssetOption[]> {
  const { data, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .in("kind", ["crypto", "fiat"])
    .order("code", { ascending: true })
    .limit(400);
  if (error) {
    console.error("assets list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string }[]).map((a) => ({ id: a.id, code: a.code }));
}

async function fetchExchangeOptions(supabase: SupabaseClient): Promise<ExchangeOption[]> {
  const { data, error } = await supabase.schema("catalog").from("exchanges").select("id, code, name").order("code");
  if (error) {
    console.error("exchanges list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string; name: string }[]).map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
  }));
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

function unwrapOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

async function fetchLatestCloseByMarketIds(
  supabase: SupabaseClient,
  marketIds: string[],
  timeframe: string,
): Promise<Map<string, { close: number; closeTimeIso: string }>> {
  const map = new Map<string, { close: number; closeTimeIso: string }>();
  const uniq = [...new Set(marketIds)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 120) {
    const chunk = uniq.slice(i, i + 120);
    const { data, error } = await supabase
      .schema("catalog")
      .from("candles")
      .select("market_id, close, candle_timestamps ( close_time )")
      .eq("timeframe", timeframe)
      .in("market_id", chunk);
    if (error) {
      console.error("executor detail: latest closes batch:", error.message);
      continue;
    }
    for (const row of (data ?? []) as {
      market_id: string;
      close: unknown;
      candle_timestamps?: { close_time?: string | null } | { close_time?: string | null }[] | null;
    }[]) {
      const mid = String(row.market_id ?? "").trim();
      if (!mid) continue;
      const ct = unwrapOne(row.candle_timestamps);
      const closeTimeIso = typeof ct?.close_time === "string" ? ct.close_time.trim() : "";
      const closeRaw = typeof row.close === "string" ? Number.parseFloat(row.close) : Number(row.close);
      const close = Number.isFinite(closeRaw) ? closeRaw : Number.NaN;
      const prev = map.get(mid);
      const t = closeTimeIso ? Date.parse(closeTimeIso) : Number.NaN;
      const prevT = prev?.closeTimeIso ? Date.parse(prev.closeTimeIso) : Number.NaN;
      if (!prev || (Number.isFinite(t) && (!Number.isFinite(prevT) || t >= prevT))) {
        map.set(mid, {
          close,
          closeTimeIso: closeTimeIso || prev?.closeTimeIso || "",
        });
      }
    }
  }
  return map;
}

type OrderRowDb = {
  id: string;
  side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
  decisions?: {
    signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
  } | {
    signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
  }[] | null;
};

type OrderRow = {
  id: string;
  market_id: string;
  bar_close_iso: string | null;
  side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
};

function normalizeExecutorOrderRow(r: OrderRowDb, candleById: Map<string, CatalogCandleBar>): OrderRow {
  const td = unwrapOne(r.decisions);
  const sig = unwrapOne(td?.signals);
  const cid = String(sig?.candle_id ?? "").trim();
  const candle = cid ? candleById.get(cid) : undefined;
  const barClose = candle?.close_time && candle.close_time.trim() ? candle.close_time.trim() : null;
  return {
    id: r.id,
    market_id: candle?.market_id ? candle.market_id.trim() : "",
    bar_close_iso: barClose,
    side: r.side,
    quantity: r.quantity,
    notional_eur: r.notional_eur,
    status: r.status,
    created_at: r.created_at,
  };
}

type LedgerRow = {
  id: string;
  kind: string;
  quantity: string | number | null;
  asset_id: string;
  note: string | null;
  created_at: string;
};

type WalletAssetBalanceRow = {
  id: string;
  asset_id: string;
  amount: string | number | null;
  updated_at: string;
};

type TradeDecisionRowDb = {
  id: string;
  signal_id: string | null;
  approved: boolean;
  created_at: string;
  signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
};

type TradeDecisionRow = {
  id: string;
  market_id: string;
  signal_id: string;
  approved: boolean;
  created_at: string;
  bar_close_iso: string | null;
};

function normalizeExecutorTradeDecisionRow(r: TradeDecisionRowDb, candleById: Map<string, CatalogCandleBar>): TradeDecisionRow {
  const sig = unwrapOne(r.signals);
  const cid = String(sig?.candle_id ?? "").trim();
  const candle = cid ? candleById.get(cid) : undefined;
  const barClose = candle?.close_time && candle.close_time.trim() ? candle.close_time.trim() : null;
  return {
    id: r.id,
    market_id: candle?.market_id ? candle.market_id.trim() : "",
    signal_id: String(r.signal_id ?? "").trim(),
    approved: r.approved,
    created_at: r.created_at,
    bar_close_iso: barClose,
  };
}

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

function shortId(uuid: string): string {
  return uuid.length > 10 ? `${uuid.slice(0, 8)}…` : uuid;
}

function sidePillClass(side: string): string {
  const s = side.toLowerCase();
  const base =
    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium capitalize tabular-nums";
  if (s === "buy") return `${base} bg-emerald-500/15 text-emerald-800 dark:text-emerald-300`;
  if (s === "sell") return `${base} bg-red-500/15 text-red-800 dark:text-red-300`;
  return `${base} bg-zinc-500/10 text-zinc-700 dark:text-zinc-300`;
}

function orderFilledPill(status: string): { label: string; className: string } {
  const base =
    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums";
  const s = status.toLowerCase();
  if (s === "filled") {
    return { label: "Yes", className: `${base} bg-emerald-500/15 text-emerald-800 dark:text-emerald-300` };
  }
  if (s === "open" || s === "pending") {
    return { label: "Partially", className: `${base} bg-amber-500/15 text-amber-900 dark:text-amber-200` };
  }
  return { label: "No", className: `${base} bg-red-500/15 text-red-800 dark:text-red-300` };
}

function approvedPillClass(approved: boolean): string {
  const base =
    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums";
  if (approved) return `${base} bg-emerald-500/15 text-emerald-800 dark:text-emerald-300`;
  return `${base} bg-red-500/15 text-red-800 dark:text-red-300`;
}

/** Long spot: avg below mark reads as better entry (green); above mark as worse (red). */
function avgVsMarkClass(avg: number, mark: number | null): string {
  const base = "shrink-0 font-mono tabular-nums";
  if (mark == null || !Number.isFinite(avg) || !Number.isFinite(mark)) return `bk-text-muted ${base}`;
  if (avg < mark) return `text-emerald-700 dark:text-emerald-400 ${base}`;
  if (avg > mark) return `text-red-700 dark:text-red-400 ${base}`;
  return `bk-text-muted ${base}`;
}

function executionModeLabel(m: string): string {
  if (m === "live") return "Live (Bitvavo — server API keys)";
  if (m === "historical") return "Historical (backtest — paper only)";
  return "Paper (simulated fills)";
}

function assetFilterModeLabel(m: ExecutorAssetFilterMode): string {
  if (m === "whitelist") return "Whitelist (only listed base assets)";
  if (m === "blacklist") return "Blacklist (all except listed base assets)";
  return "All assets";
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
  const fmtPrimaryApprox = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v)
      ? "—"
      : formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  const fmtDt = (iso: string | null | undefined) => (iso ? formatDatetime(iso, prefs) : "—");

  const { data: ex, error: exErr } = await supabase
    .schema("trading")
    .from("executors")
    .select(
      "id, wallet_id, name, enabled, exchange_id, execution_mode, asset_filter_mode, filter_asset_ids, allowed_sides, updated_at, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret, historical_start_date, historical_end_date, risk_open_position_count, risk_exposure_by_market, risk_daily_pnl_eur, risk_runtime_max_drawdown_eur, risk_kill_switch, risk_consecutive_losses",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (exErr) return <Alert tone="error">{exErr.message}</Alert>;
  if (!ex) notFound();

  const { data: budgetRows, error: budgetErr } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("id, quote_asset_id, max_notional_primary")
    .eq("executor_id", id)
    .order("created_at", { ascending: true });
  if (budgetErr) {
    console.error("executor detail: budgets:", budgetErr.message);
  }
  type BudgetRowDb = {
    id: string;
    quote_asset_id: string;
    max_notional_primary: string | number;
  };
  const budgetRowsRaw = (budgetRows ?? []) as BudgetRowDb[];
  const quoteBudgetsForForm: ExecutorQuoteBudgetInitial[] = budgetRowsRaw.map((row) => ({
    quote_asset_id: row.quote_asset_id,
    max_notional_primary: String(row.max_notional_primary ?? ""),
  }));

  const initial = executorRowToFormInitial(ex, { quoteBudgets: quoteBudgetsForForm });
  const filterIds = initial.filter_asset_ids;
  const slackTradeNotificationsEnabled = initial.slack_trade_notifications_enabled !== false;
  const exchangeApiCredentialsConfigured = Boolean(initial.exchange_api_credentials_configured);
  const exchangeApiKeySuffix = initial.exchange_api_key_suffix;
  const mediator_rails_extra_json = initial.mediator_rails_extra_json;

  const ledgerFetchLimit = ledgerFull ? EXECUTOR_LEDGER_FULL_FETCH_CAP : RECORD_RELATED_LIST_PREVIEW_ROWS;
  const ledgerUiPreviewLimit = ledgerFull ? EXECUTOR_LEDGER_FULL_FETCH_CAP : RECORD_RELATED_LIST_PREVIEW_ROWS;

  const [
    assetOptions,
    exchangeOptions,
    quoteAssetOptionsByExchange,
    exchangeCapabilitiesById,
    pnl,
    walletPack,
    ordPack,
    tdPack,
    posPack,
  ] = await Promise.all([
    fetchAssetOptions(supabase),
    fetchExchangeOptions(supabase),
    fetchQuoteAssetOptionsByExchange(supabase),
    fetchExchangeCapabilitiesById(supabase),
    loadExecutorPnlSnapshot(supabase, { executorId: id, userId: user.id }),
    supabase.schema("trading").from("wallets").select("id").eq("executor_id", id).maybeSingle(),
    supabase
      .schema("trading")
      .from("orders")
      .select(
        "id, side, quantity, notional_eur, status, created_at, decisions ( signals ( candle_id ) )",
        { count: "exact" },
      )
      .eq("executor_id", id)
      .order("created_at", { ascending: false })
      .limit(DASHBOARD_LIST_VIEW_LIMIT),
    supabase
      .schema("trading")
      .from("decisions")
      .select("id, signal_id, approved, created_at, signals ( candle_id )", {
        count: "exact",
      })
      .eq("executor_id", id)
      .order("created_at", { ascending: false })
      .limit(EXECUTOR_DETAIL_TRADE_DECISION_POOL),
    supabase
      .schema("trading")
      .from("positions")
      .select("id, market_id, quantity, avg_price, paper, updated_at", { count: "exact" })
      .eq("executor_id", id)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(DASHBOARD_LIST_VIEW_LIMIT),
  ]);

  const walletIdFromExecutor = String((ex as { wallet_id?: string | null }).wallet_id ?? "").trim();
  const walletIdFromTable = String((walletPack.data as { id?: string } | null)?.id ?? "").trim();
  const walletId = walletIdFromExecutor || walletIdFromTable || null;
  const ledgerPack = walletId
    ? await supabase
        .schema("trading")
        .from("wallet_transactions")
        .select("id, kind, quantity, asset_id, note, created_at", { count: "exact" })
        .eq("wallet_id", walletId)
        .order("created_at", { ascending: false })
        .limit(ledgerFetchLimit)
    : { data: [] as LedgerRow[], count: 0, error: null };

  const walletAssetBalanceFetchLimit = RECORD_RELATED_LIST_PREVIEW_ROWS;
  const walletAssetBalancePack = walletId
    ? await supabase
        .schema("trading")
        .from("wallet_asset_balance")
        .select("id, asset_id, amount, updated_at", { count: "exact" })
        .eq("wallet_id", walletId)
        .order("updated_at", { ascending: false })
        .limit(walletAssetBalanceFetchLimit)
    : { data: [] as WalletAssetBalanceRow[], count: 0, error: null };

  const eurFallbackQuoteId = await resolveQuoteAssetId(supabase, "EUR");
  const historicalPaperMarket =
    String(ex.execution_mode) === "historical" && filterIds.length === 1
      ? await fetchHistoricalExecutorPaperMarket(supabase, {
          executorExchangeId: String(ex.exchange_id ?? "").trim(),
          filterBaseAssetId: filterIds[0]!,
        })
      : null;
  /** Risk card / EUR line: quote balance on the replay market when historical + one filter; otherwise catalog EUR. */
  const replayQuoteAssetId =
    String(ex.execution_mode) === "historical"
      ? (historicalPaperMarket?.quoteAssetId ?? null)
      : eurFallbackQuoteId;
  const eurWalletBalance =
    replayQuoteAssetId != null
      ? await fetchWalletBalanceForAsset(supabase, { executorId: id, assetId: replayQuoteAssetId })
      : 0;
  const eurAssetId = replayQuoteAssetId ?? eurFallbackQuoteId;

  const rsRow = {
    equity_eur: eurWalletBalance,
    updated_at: String(ex?.updated_at ?? ""),
  };

  const rsErr = walletPack.error;

  const { data: ledgerRows, count: ledgerCount, error: ledgerPackErr } = ledgerPack;
  const lgErr = ledgerPackErr ?? null;
  const ledger = (ledgerRows ?? []) as LedgerRow[];
  const ledgerTotal = typeof ledgerCount === "number" ? ledgerCount : ledger.length;

  const {
    data: walletAssetBalanceRowsRaw,
    count: walletAssetBalanceCount,
    error: walletAssetBalanceErr,
  } = walletAssetBalancePack;
  const wabErr = walletAssetBalanceErr ?? null;
  const walletAssetBalanceRows = (walletAssetBalanceRowsRaw ?? []) as WalletAssetBalanceRow[];
  const walletAssetBalanceTotal =
    typeof walletAssetBalanceCount === "number" ? walletAssetBalanceCount : walletAssetBalanceRows.length;

  const { data: ordRows, count: orderCount, error: ordErr } = ordPack;
  const ordRowsRaw = (ordRows ?? []) as OrderRowDb[];
  const { data: tdRows, count: tdCount, error: tdErr } = tdPack;
  const tdRowsRaw = (tdRows ?? []) as TradeDecisionRowDb[];

  const candleIdsForEmbed = [
    ...ordRowsRaw.map((r) => {
      const td = unwrapOne(r.decisions);
      const sig = unwrapOne(td?.signals);
      return String(sig?.candle_id ?? "").trim();
    }),
    ...tdRowsRaw.map((r) => {
      const sig = unwrapOne(r.signals);
      return String(sig?.candle_id ?? "").trim();
    }),
  ].filter(Boolean);
  const candleById = await fetchCatalogCandlesByIds(supabase, candleIdsForEmbed);

  const orders = ordRowsRaw.map((r) => normalizeExecutorOrderRow(r, candleById));
  const orderTotal = typeof orderCount === "number" ? orderCount : orders.length;

  const tradeDecisionsRaw = tdRowsRaw
    .map((r) => normalizeExecutorTradeDecisionRow(r, candleById))
    .sort(
      (a, b) =>
        Date.parse(b.bar_close_iso ?? b.created_at) - Date.parse(a.bar_close_iso ?? a.created_at),
    );
  const tradeDecisionTotal = typeof tdCount === "number" ? tdCount : tradeDecisionsRaw.length;

  const assetCodeById = new Map(assetOptions.map((o) => [o.id, o.code]));

  function parseDollarCell(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const primaryPref = prefs.primary_asset;
  const dollarIdSet = new Set<string>();
  if (eurAssetId) dollarIdSet.add(eurAssetId);
  for (const r of ledger) dollarIdSet.add(r.asset_id);
  if (primaryPref?.id) dollarIdSet.add(primaryPref.id);
  const dollarIdList = [...dollarIdSet].filter(Boolean);
  const dollarById = new Map<string, number | null>();
  if (dollarIdList.length) {
    const { data: dvRows } = await supabase
      .schema("catalog")
      .from("assets")
      .select("id, dollar_value")
      .in("id", dollarIdList);
    for (const row of (dvRows ?? []) as { id: string; dollar_value: unknown }[]) {
      dollarById.set(row.id, parseDollarCell(row.dollar_value));
    }
  }

  const eurWalletInPrimary =
    primaryPref && eurAssetId
      ? valueInPrimaryUnits({
          quantity: eurWalletBalance,
          fromDollarValue: dollarById.get(eurAssetId) ?? null,
          primaryDollarValue: primaryPref.dollar_value,
          primaryAssetCode: primaryPref.code,
        })
      : null;

  const runtimeRiskSnapshot = {
    id: ex.id,
    open_position_count: Number((ex as { risk_open_position_count?: number }).risk_open_position_count ?? 0),
    daily_pnl_eur: (ex as { risk_daily_pnl_eur?: string | number | null }).risk_daily_pnl_eur ?? 0,
    max_drawdown_eur: (ex as { risk_runtime_max_drawdown_eur?: string | number | null }).risk_runtime_max_drawdown_eur ?? 0,
    kill_switch: Boolean((ex as { risk_kill_switch?: boolean }).risk_kill_switch),
    consecutive_losses: Number((ex as { risk_consecutive_losses?: number }).risk_consecutive_losses ?? 0),
    updated_at: String(ex.updated_at ?? ""),
    eur_wallet: eurWalletBalance,
    eur_wallet_in_primary: eurWalletInPrimary,
    primary_asset_code: primaryPref?.code ?? null,
  };

  const { data: posRows, count: posCount, error: posErr } = posPack;
  const positions = (posRows ?? []) as PositionRow[];
  const positionTotal = typeof posCount === "number" ? posCount : positions.length;

  const markByMarket = await fetchLatestCloseByMarketIds(
    supabase,
    positions.map((p) => p.market_id),
    CATALOG_STORAGE_TIMEFRAME,
  );

  const marketIdsForLabels = [
    ...orders.map((o) => o.market_id),
    ...tradeDecisionsRaw.map((d) => d.market_id),
    ...positions.map((p) => p.market_id),
  ];
  const symMap = await marketSymbolMap(supabase, marketIdsForLabels);

  const executorExchangeId = String(ex.exchange_id ?? "").trim();
  const executorExchangeOption = exchangeOptions.find((o) => o.id === executorExchangeId);
  const executorExchangeLinkName =
    String(executorExchangeOption?.name ?? "").trim() ||
    String(executorExchangeOption?.code ?? "").trim() ||
    executorExchangeId ||
    "—";

  const primaryCode = prefs.primary_asset?.code ?? "EUR";
  const budgetsForList = budgetRowsRaw.map((row) => ({
    id: row.id,
    quote_asset_id: row.quote_asset_id,
    quote_asset_code:
      assetCodeById.get(row.quote_asset_id) ?? `${row.quote_asset_id.slice(0, 8)}…`,
    max_notional_primary: String(row.max_notional_primary ?? ""),
  }));
  const existingBudgetQuoteIds = new Set(budgetsForList.map((b) => b.quote_asset_id));
  const quoteOptsForThisExchange = quoteAssetOptionsByExchange[executorExchangeId] ?? [];
  const availableQuoteOptionsForNew = quoteOptsForThisExchange.filter(
    (o) => !existingBudgetQuoteIds.has(o.id),
  );

  const ledgerViewAll = ledgerFull ? undefined : `/executors/${id}?ledger=all`;

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg"
      header={
        <div className="bk-stack bk-stack_gap-md">
          {objectRegistry.registrations.get("executors")!.CreateDetailPageHeader({
            record: ex as Record<string, unknown>,
            subtitle: "Balance, orders, and related activity for this portfolio.",
            highlights: (
              <>
                <Output label="Enabled" type="boolean" value={ex.enabled} />
                <Output label="Execution mode" type="text" value={executionModeLabel(String(ex.execution_mode ?? ""))} />
                <Output label="Slack trade fills" type="boolean" value={slackTradeNotificationsEnabled} />
                <Output label="Exchange API credentials" type="boolean" value={exchangeApiCredentialsConfigured} />
                <Output label="Orders (preview)" type="number" value={orderTotal} />
                <Output
                  label="Exchange"
                  type="text"
                  value={
                    executorExchangeId ? (
                      <Link href={`/exchanges/${executorExchangeId}`} className="bk-link">
                        {executorExchangeLinkName}
                      </Link>
                    ) : (
                      "—"
                    )
                  }
                />
              </>
            ),
            actions: (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Link href={`/executors/new?from=${encodeURIComponent(id)}`} className={listViewOutlineActionClass}>
                  Clone
                </Link>
                <ExecutorDetailBalanceActions
                  executorId={id}
                  assetOptions={assetOptions}
                  preferredDepositAssetId={
                    String(ex.execution_mode) === "historical" && filterIds.length === 1
                      ? filterIds[0]!
                      : (historicalPaperMarket?.quoteAssetId ?? null)
                  }
                />
                {String(ex.execution_mode) === "historical" ? (
                  <ExecutorHistoricalRunHeaderAction executorId={id} />
                ) : null}
                <ExecutorEditDialog
                  executorId={id}
                  assetOptions={assetOptions}
                  exchangeOptions={exchangeOptions}
                  quoteAssetOptionsByExchange={quoteAssetOptionsByExchange}
                  exchangeCapabilitiesById={exchangeCapabilitiesById}
                  primaryAssetCode={prefs.primary_asset?.code ?? "EUR"}
                  initial={initial}
                />
              </div>
            ),
          })}
          {ledgerFull ? (
            <Alert tone="info">
              Showing expanded wallet transactions (newest first, cap {EXECUTOR_LEDGER_FULL_FETCH_CAP} rows).
              {ledgerTotal > ledger.length
                ? ` ${ledgerTotal - ledger.length} older row(s) exist in the database but are not loaded here.`
                : null}{" "}
              <Link href={`/executors/${id}`} className="bk-link">
                Back to preview
              </Link>
              .
            </Alert>
          ) : null}
          {ordErr ? <Alert tone="error">{ordErr.message}</Alert> : null}
          {rsErr ? <Alert tone="error">{rsErr.message}</Alert> : null}
          {lgErr ? <Alert tone="error">{lgErr.message}</Alert> : null}
          {wabErr ? <Alert tone="error">{wabErr.message}</Alert> : null}
          {tdErr ? <Alert tone="error">{tdErr.message}</Alert> : null}
          {posErr ? <Alert tone="error">{posErr.message}</Alert> : null}
        </div>
      }
      content={
        <RecordPageTabs
          details={
            <div className="bk-stack bk-stack_gap-md">
              <RecordPageCard>
                <RecordPageSection title="Configuration">
                  <RecordPageGrid>
                    <Output label="Name" type="text" value={String(ex.name ?? "")} />
                    <Output label="Enabled" type="boolean" value={ex.enabled} />
                    <Output label="Slack trade-fill notifications" type="boolean" value={slackTradeNotificationsEnabled} />
                    <Output label="Exchange API credentials" type="boolean" value={exchangeApiCredentialsConfigured} />
                    <Output
                      label="Stored API key (suffix)"
                      type="text"
                      value={exchangeApiCredentialsConfigured ? (exchangeApiKeySuffix ? `…${exchangeApiKeySuffix}` : "—") : "—"}
                    />
                    <Output label="Execution mode" type="text" value={executionModeLabel(String(ex.execution_mode ?? ""))} />
                    {executorExchangeId ? (
                      <Output
                        label="Exchange"
                        record={{
                          pathPrefix: "/exchanges",
                          id: executorExchangeId,
                          name: executorExchangeLinkName,
                        }}
                        value={executorExchangeLinkName}
                      />
                    ) : (
                      <Output label="Exchange" type="text" value="—" />
                    )}
                    {walletId ? (
                      <Output
                        label="Wallet"
                        record={{ pathPrefix: "/wallets", id: walletId, name: shortId(walletId) }}
                        value={shortId(walletId)}
                      />
                    ) : (
                      <Output label="Wallet" type="text" value="—" />
                    )}
                    <Output label="Asset filter" type="text" value={assetFilterModeLabel(ex.asset_filter_mode as ExecutorAssetFilterMode)} />
                    <Output
                      label="Filter assets (base)"
                      type="text"
                      value={
                        ex.asset_filter_mode === "all"
                          ? "—"
                          : filterIds
                              .map((fid) => assetOptions.find((o) => o.id === fid)?.code ?? fid.slice(0, 8) + "…")
                              .join(", ") || "—"
                      }
                      span="full"
                    />
                    {String(ex.execution_mode) === "historical" ? (
                      <>
                        <Output
                          label="Historical start (UTC date)"
                          type="text"
                          value={String((ex as { historical_start_date?: string | null }).historical_start_date ?? "—")}
                        />
                        <Output
                          label="Historical end (UTC date)"
                          type="text"
                          value={String((ex as { historical_end_date?: string | null }).historical_end_date ?? "—")}
                        />
                      </>
                    ) : null}
                  </RecordPageGrid>
                </RecordPageSection>
                <RecordPageSection title="Quote-asset budgets">
                  {quoteBudgetsForForm.length === 0 ? (
                    <Alert tone="warning">
                      No quote-asset budgets configured. The mediator will skip every market for this executor with
                      reason <code className="bk-code">quote_asset_not_allowed</code> until at least one row is added
                      via Edit.
                    </Alert>
                  ) : (
                    <div className="bk-stack bk-stack_gap-sm">
                      <p className="bk-text-muted text-xs">
                        Notional per allowed quote, stored in your primary fiat (
                        <code className="bk-code">{prefs.primary_asset?.code ?? "EUR"}</code>) and converted to the
                        market quote at decision time using each asset&rsquo;s{" "}
                        <code className="bk-code">dollar_value</code>.
                      </p>
                      <table className="w-full max-w-md text-sm">
                        <thead>
                          <tr className="bk-text-muted text-left text-xs">
                            <th className="pb-1 pr-4 font-medium">Quote asset</th>
                            <th className="pb-1 font-medium">
                              Max notional ({prefs.primary_asset?.code ?? "EUR"})
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {quoteBudgetsForForm.map((b) => (
                            <tr key={b.quote_asset_id} className="border-border border-t">
                              <td className="py-1 pr-4 font-mono text-xs">
                                {assetOptions.find((o) => o.id === b.quote_asset_id)?.code ??
                                  b.quote_asset_id.slice(0, 8) + "…"}
                              </td>
                              <td className="py-1 font-mono tabular-nums">
                                {fmtEur(b.max_notional_primary)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </RecordPageSection>
                <RecordPageSection title="Mediator / risk rails">
                  <RecordPageGrid>
                    <Output label="Max risk per trade (0–1)" type="text" value={String(ex.max_risk_per_trade ?? "—")} />
                    <Output label="Max open positions" type="number" value={ex.max_open_positions ?? 0} />
                    <Output label="Max exposure per symbol (EUR)" type="text" value={fmtEur(ex.max_exposure_per_symbol_eur)} />
                    <Output label="Daily loss limit (EUR)" type="text" value={fmtEur(ex.daily_loss_limit_eur)} />
                    <Output label="Max drawdown (EUR)" type="text" value={fmtEur(ex.max_drawdown_eur)} />
                    <Output label="Cooldown after losses" type="number" value={ex.cooldown_after_losses ?? 0} />
                    <Output label="Allow ADD intent" type="boolean" value={Boolean(ex.allow_add)} />
                    <Output label="Profit taking enabled" type="boolean" value={Boolean(ex.profit_taking_enabled)} />
                    <Output label="Moving floor trail pct" type="text" value={String(ex.moving_floor_trail_pct ?? "—")} />
                    <Output
                      label="Moving floor activation pct"
                      type="text"
                      value={String(ex.moving_floor_activation_profit_pct ?? "—")}
                    />
                    <Output label="Moving floor timeframe" type="text" value={String(ex.moving_floor_timeframe ?? "—")} />
                    <Output label="Advanced rails (JSON)" type="codeblock" value={mediator_rails_extra_json} span="full" />
                  </RecordPageGrid>
                </RecordPageSection>
              </RecordPageCard>
            </div>
          }
          related={
            <div className="bk-stack bk-stack_gap-md">
              <RecordRelatedList
                title="Orders"
                icon={<ListViewObjectIcon letter="O" />}
                description="Id, market, side, bar close (via signal candle), filled. Newest first."
                  items={orders}
                  getKey={(o) => o.id}
                  totalCount={orderTotal}
                  viewAllHref={`/executors/${id}/orders`}
                  emptyMessage="No orders for this executor yet."
                  renderRow={(o) => {
                    const sym = o.market_id
                      ? (symMap.get(o.market_id) ?? `${o.market_id.slice(0, 8)}…`)
                      : "—";
                    const closeIso = o.bar_close_iso;
                    const filled = orderFilledPill(o.status);
                    const rawSide = String(o.side ?? "").trim();
                    const sideLabel = rawSide
                      ? `${rawSide.charAt(0).toUpperCase()}${rawSide.slice(1).toLowerCase()}`
                      : "—";
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem]">
                        <Link href={`/orders/${o.id}`} className="bk-link shrink-0 font-mono" title={o.id}>
                          {shortId(o.id)}
                        </Link>
                        {o.market_id ? (
                          <Link href={`/markets/${o.market_id}`} className="bk-link shrink-0 font-mono">
                            {sym}
                          </Link>
                        ) : (
                          <span className="bk-text-muted shrink-0 font-mono">{sym}</span>
                        )}
                        <span className={sidePillClass(o.side)}>{sideLabel}</span>
                        <span
                          className="bk-text-muted shrink-0 whitespace-nowrap font-mono text-[0.75rem]"
                          title={closeIso ?? undefined}
                        >
                          {fmtDt(closeIso)}
                        </span>
                        <span className={filled.className}>{filled.label}</span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Positions"
                  icon={<ListViewObjectIcon letter="P" />}
                  description="Market, qty, mark (latest catalog close), PnL (EUR), avg vs mark. Newest first."
                  items={positions}
                  getKey={(p) => p.id}
                  totalCount={positionTotal}
                  viewAllHref={`/executors/${id}/positions`}
                  emptyMessage="No open positions for this executor yet."
                  renderRow={(p) => {
                    const sym = symMap.get(p.market_id) ?? `${p.market_id.slice(0, 8)}…`;
                    const markEntry = markByMarket.get(p.market_id);
                    const markPx = markEntry?.close;
                    const qtyN = Number(p.quantity);
                    const avgN =
                      p.avg_price != null && String(p.avg_price).trim() !== "" ? Number(p.avg_price) : Number.NaN;
                    const pnlEur =
                      Number.isFinite(qtyN) && Number.isFinite(avgN) && markPx != null && Number.isFinite(markPx)
                        ? qtyN * (markPx - avgN)
                        : null;
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem]">
                        <Link href={`/executors/${id}/positions`} className="bk-link shrink-0 font-mono" title={p.id}>
                          {shortId(p.id)}
                        </Link>
                        <Link href={`/markets/${p.market_id}`} className="bk-link shrink-0 font-mono">
                          {sym}
                        </Link>
                        <span className="bk-text-muted shrink-0 font-mono tabular-nums">{fmtQty(p.quantity)}</span>
                        <span className="bk-text-muted shrink-0 font-mono tabular-nums" title="Latest catalog close">
                          {markPx != null && Number.isFinite(markPx) ? fmtQty(markPx) : "—"}
                        </span>
                        <span
                          className={
                            pnlEur == null || !Number.isFinite(pnlEur)
                              ? "bk-text-muted shrink-0 font-mono tabular-nums"
                              : pnlEur >= 0
                                ? "shrink-0 font-mono tabular-nums text-emerald-700 dark:text-emerald-400"
                                : "shrink-0 font-mono tabular-nums text-red-700 dark:text-red-400"
                          }
                        >
                          {pnlEur != null && Number.isFinite(pnlEur) ? fmtEur(pnlEur) : "—"}
                        </span>
                        <span
                          className={avgVsMarkClass(
                            avgN,
                            markPx != null && Number.isFinite(markPx) ? markPx : null,
                          )}
                          title="Average entry vs mark"
                        >
                          {p.avg_price != null && String(p.avg_price).trim() !== "" ? fmtQty(p.avg_price) : "—"}
                        </span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Trade decisions"
                  icon={<ListViewObjectIcon letter="T" />}
                  description="Id, signal, market, approved, bar close. Sorted by bar close (newest first)."
                  items={tradeDecisionsRaw}
                  getKey={(r) => r.id}
                  totalCount={tradeDecisionTotal}
                  viewAllHref={`/executors/${id}/trade-decisions`}
                  emptyMessage="No trade decisions for this executor yet."
                  renderRow={(row) => {
                    const mLabel = row.market_id
                      ? (symMap.get(row.market_id) ?? `${row.market_id.slice(0, 8)}…`)
                      : "—";
                    const sid = row.signal_id;
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem]">
                        <Link href={`/trade-decisions/${row.id}`} className="bk-link shrink-0 font-mono" title={row.id}>
                          {shortId(row.id)}
                        </Link>
                        {sid ? (
                          <Link href={`/signals/${sid}`} className="bk-link shrink-0 font-mono" title={sid}>
                            {shortId(sid)}
                          </Link>
                        ) : (
                          <span className="bk-text-muted shrink-0 text-[0.75rem]">—</span>
                        )}
                        {row.market_id ? (
                          <Link href={`/markets/${row.market_id}`} className="bk-link shrink-0 font-mono">
                            {mLabel}
                          </Link>
                        ) : (
                          <span className="bk-text-muted shrink-0 font-mono">{mLabel}</span>
                        )}
                        <span className={approvedPillClass(row.approved)}>{row.approved ? "Yes" : "No"}</span>
                        <span className="bk-text-muted shrink-0 whitespace-nowrap font-mono text-[0.75rem]">
                          {fmtDt(row.bar_close_iso)}
                        </span>
                      </div>
                    );
                  }}
                />

                <RecordRelatedList
                  title="Runtime risk"
                  icon={<ListViewObjectIcon letter="R" />}
                  description="Counters stored on the executor (mediator / catalog close). Wallet line shows EUR catalog balance and an approximation in your primary fiat when rates exist."
                  items={[runtimeRiskSnapshot]}
                  getKey={(r) => r.id}
                  totalCount={1}
                  viewAllHref={`/risk-state?executorId=${encodeURIComponent(id)}`}
                  emptyMessage="—"
                  renderRow={(r) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="font-mono">
                        {r.primary_asset_code
                          ? `${r.primary_asset_code} ≈ ${fmtPrimaryApprox(r.eur_wallet_in_primary)} (EUR ${fmtEur(r.eur_wallet)})`
                          : `EUR ${fmtEur(r.eur_wallet)}`}{" "}
                        · Open {r.open_position_count}
                      </span>
                      <span className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
                        daily PnL {fmtEur(r.daily_pnl_eur)} · max DD {fmtEur(r.max_drawdown_eur)} · kill {r.kill_switch ? "on" : "off"} ·
                        losses {r.consecutive_losses} · updated {fmtDt(r.updated_at)}
                      </span>
                    </div>
                  )}
                />
            </div>
          }
        />
      }
      sidebar={
        <div className="bk-stack bk-stack_gap-md">
          <RecordTasksRelatedCard relatedSchema="trading" relatedTable="executors" relatedId={id} />
          <p className="bk-text-muted text-xs font-medium uppercase tracking-wide">Reports</p>
          <Card>
            <CardBody>
              <p className="bk-text-muted text-xs">
                EUR wallet (Bitvavo quote) — approx. in {prefs.primary_asset?.code ?? "—"}
              </p>
              <p className="mt-1 font-mono text-lg">{fmtPrimaryApprox(eurWalletInPrimary)}</p>
              <p className="bk-text-muted mt-1 text-xs font-mono">Native EUR: {fmtEur(rsRow?.equity_eur ?? 0)}</p>
              <p className="bk-text-muted mt-2 text-xs">
                Simulated balance for the EUR asset in this executor wallet. Approximation uses catalog `dollar_value` (USD per unit) and your primary fiat from{" "}
                <Link href="/me/preferences" className="bk-link">
                  My preferences
                </Link>
                . Buys debit the market quote asset. Not your exchange balance.
              </p>
              <p className="bk-text-muted mt-1 text-xs font-mono">Updated {fmtDt(rsRow?.updated_at ?? null)}</p>
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
          <Card>
            <CardBody>
              <p className="bk-text-muted text-xs">Open cost basis (EUR)</p>
              <p className="mt-1 font-mono text-lg">{fmtEur(pnl.openCostBasisEur)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="bk-text-muted text-xs">Filled buy notional (EUR)</p>
              <p className="mt-1 font-mono text-lg">{fmtEur(pnl.filledBuyNotionalEur)}</p>
            </CardBody>
          </Card>

          <div className="mt-4">
            <RecordRelatedList
              title="Wallet asset balances"
              icon={<ListViewObjectIcon letter="B" />}
              description="System-maintained per-asset balance for this executor's wallet. Updated by the wallet_transactions trigger."
              items={walletAssetBalanceRows}
              getKey={(r) => r.id}
              totalCount={walletAssetBalanceTotal}
              viewAllHref={`/executors/${id}/wallet-asset-balance`}
              alwaysShowViewAll
              emptyMessage="No wallet asset balances yet. Use Add balance in the header to credit an asset."
              renderRow={(row) => {
                const code =
                  assetCodeById.get(row.asset_id) ?? `${row.asset_id.slice(0, 8)}…`;
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                    <code className="bk-code shrink-0">{code}</code>
                    <span
                      className="bk-text-muted flex flex-wrap items-center gap-x-3 gap-y-1"
                      style={{ fontSize: "0.75rem" }}
                    >
                      <span className="font-mono tabular-nums">{fmtQty(row.amount)}</span>
                      <span className="whitespace-nowrap font-mono">{fmtDt(row.updated_at)}</span>
                    </span>
                  </div>
                );
              }}
            />
          </div>

          <div className="mt-4">
            <RecordRelatedList
              title="Quote-asset budgets"
              icon={<ListViewObjectIcon letter="Q" />}
              description={`Notional caps per quote asset, stored in your primary fiat (${primaryCode}).`}
              items={budgetsForList}
              getKey={(r) => r.id}
              totalCount={budgetsForList.length}
              viewAllHref={`/executors/${id}/executor-quote-asset-budgets`}
              alwaysShowViewAll
              actions={
                <ExecutorQuoteBudgetCreateDialog
                  executorId={id}
                  availableOptions={availableQuoteOptionsForNew}
                  primaryCode={primaryCode}
                />
              }
              emptyMessage="No budgets configured. Add one to enable a quote-asset book."
              renderRow={(row) => (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                  <span className="flex shrink-0 flex-wrap items-center gap-2 font-mono">
                    <code className="bk-code">{row.quote_asset_code}</code>
                    <span className="bk-text-muted">·</span>
                    <span className="tabular-nums">
                      {fmtEur(row.max_notional_primary)} {primaryCode}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <ExecutorQuoteBudgetEditDialog
                      executorId={id}
                      budgetId={row.id}
                      currentQuoteAssetId={row.quote_asset_id}
                      currentQuoteAssetCode={row.quote_asset_code}
                      currentMaxNotionalPrimary={row.max_notional_primary}
                      availableOptions={availableQuoteOptionsForNew}
                      primaryCode={primaryCode}
                    />
                    <ExecutorQuoteBudgetDeleteDialog
                      executorId={id}
                      budgetId={row.id}
                      quoteAssetCode={row.quote_asset_code}
                    />
                  </span>
                </div>
              )}
            />
          </div>

          <div className="mt-4">
            <RecordRelatedList
                title="Wallet transactions"
                icon={<ListViewObjectIcon letter="W" />}
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
                emptyMessage="No wallet transactions yet. Use Add balance in the header to credit an asset."
                renderRow={(row) => {
                  const q = Number(row.quantity);
                  const approxPrimary =
                    primaryPref && Number.isFinite(q)
                      ? valueInPrimaryUnits({
                          quantity: q,
                          fromDollarValue: dollarById.get(row.asset_id) ?? null,
                          primaryDollarValue: primaryPref.dollar_value,
                          primaryAssetCode: primaryPref.code,
                        })
                      : null;
                  return (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                    <span>{ledgerKindLabel(row.kind)}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 bk-text-muted" style={{ fontSize: "0.75rem" }}>
                      <span className="font-mono">
                        {fmtQty(row.quantity)} {assetCodeById.get(row.asset_id) ?? row.asset_id.slice(0, 8) + "…"}
                      </span>
                      <span className="font-mono" title={primaryPref ? `Approx. in ${primaryPref.code}` : undefined}>
                        ≈ {fmtPrimaryApprox(approxPrimary)}
                        {primaryPref ? ` ${primaryPref.code}` : ""}
                      </span>
                      <span className="max-w-[200px] truncate" title={row.note ?? undefined}>
                        {row.note ?? "—"}
                      </span>
                      <span className="whitespace-nowrap font-mono">{fmtDt(row.created_at)}</span>
                    </span>
                  </div>
                  );
                }}
              />
          </div>
        </div>
      }
    />
  );
}
