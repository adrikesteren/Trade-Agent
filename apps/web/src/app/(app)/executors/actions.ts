"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ensureRiskStateForExecutor } from "@/lib/agents/executor/services/executors-lookup.service";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

function revalidateExecutorSurface(executorId: string) {
  revalidatePath("/executors");
  revalidatePath(`/executors/${executorId}`);
  revalidatePath(`/executors/${executorId}/orders`);
  revalidatePath(`/executors/${executorId}/trade-decisions`);
  revalidatePath(`/executors/${executorId}/positions`);
}

export type ExecutorAssetFilterMode = "all" | "whitelist" | "blacklist";
export type ExecutionModeValue = "paper" | "live" | "historical";

function parseFilterMode(raw: FormDataEntryValue | null): ExecutorAssetFilterMode {
  const s = String(raw ?? "").trim();
  if (s === "whitelist" || s === "blacklist" || s === "all") return s;
  return "all";
}

function parseExecutionMode(raw: FormDataEntryValue | null): ExecutionModeValue {
  const s = String(raw ?? "").trim();
  if (s === "live" || s === "paper" || s === "historical") return s;
  return "paper";
}

/** HTML date input (YYYY-MM-DD) → Postgres `date` string. */
function parseHistoryDate(label: string, raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${label} must be a calendar date (YYYY-MM-DD).`);
  }
  return s;
}

async function assertExchangeIsBitvavo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  exchangeId: string,
): Promise<void> {
  const codeRaw = await ExchangesSelector.selectCodeById(supabase, exchangeId);
  const code = String(codeRaw ?? "").toLowerCase();
  if (code !== "bitvavo") {
    throw new Error("Historical execution mode requires the Bitvavo exchange.");
  }
}

export type PositionSideValue = "long" | "short";

/**
 * Parse the multi-checkbox `allowed_sides` form field into a deduplicated array.
 * Defaults to `["long"]` so legacy clients (or empty submissions) still match the
 * pre-P2 behaviour. The caller is expected to additionally validate each entry
 * against the selected exchange's capability flags via {@link assertSidesAllowedByExchange}.
 */
function parseAllowedSides(formData: FormData): PositionSideValue[] {
  const all = formData.getAll("allowed_sides");
  const out = new Set<PositionSideValue>();
  for (const v of all) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s === "long" || s === "short") out.add(s);
  }
  if (out.size === 0) {
    // DB CHECK requires at least one element. Default to long which matches
    // the pre-P2 behaviour and works on every exchange that supports spot buy.
    return ["long"];
  }
  return [...out];
}

/**
 * Reject a side that the exchange does not support before we hit the DB. The
 * mediator + executor enforce this again at runtime, but rejecting at the form
 * boundary gives a clearer error message and keeps invalid rows out of the table.
 */
async function assertSidesAllowedByExchange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  exchangeId: string,
  sides: PositionSideValue[],
): Promise<void> {
  const data = await ExchangesSelector.selectCapabilitiesById(supabase, exchangeId);
  if (!data) throw new Error("Exchange not found.");
  const longSupported = Boolean(data.supports_spot_buy) || Boolean(data.supports_margin_long);
  const shortSupported = Boolean(data.supports_margin_short);
  for (const s of sides) {
    if (s === "long" && !longSupported) {
      throw new Error("This exchange does not support long entries (no spot buy and no margin long).");
    }
    if (s === "short" && !shortSupported) {
      throw new Error("This exchange does not support short selling.");
    }
  }
}

function parseAssetIds(formData: FormData): string[] {
  const all = formData.getAll("filter_asset_ids");
  const out: string[] = [];
  for (const v of all) {
    const s = String(v ?? "").trim();
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

function parseNonNegInt(name: string, raw: FormDataEntryValue | null): number {
  const n = Math.floor(Number(String(raw ?? "").trim()));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer.`);
  return n;
}

function parseNonNegNumber(name: string, raw: FormDataEntryValue | null): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number.`);
  return n;
}

function parseMaxRiskPerTrade(raw: FormDataEntryValue | null): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    throw new Error("Max risk per trade must be a fraction between 0 and 1 (e.g. 0.05 for 5%).");
  }
  return n;
}

function parseMediatorRailsExtra(formData: FormData): Record<string, unknown> {
  const raw = String(formData.get("mediator_rails_extra") ?? "").trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Advanced rails JSON is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Advanced rails JSON must be a JSON object.");
  }
  const s = JSON.stringify(parsed);
  if (s.length > 16_000) throw new Error("Advanced rails JSON is too large.");
  return parsed as Record<string, unknown>;
}

function parseUuidLike(name: string, raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error(`${name} is required.`);
  return s;
}

function parseUnitInterval(name: string, raw: FormDataEntryValue | null, allowZero: boolean): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  if (allowZero) {
    if (n < 0 || n >= 1) throw new Error(`${name} must be between 0 and 1.`);
  } else if (n <= 0 || n >= 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
  return n;
}

function mediatorFieldsFromForm(formData: FormData) {
  return {
    max_risk_per_trade: parseMaxRiskPerTrade(formData.get("max_risk_per_trade")),
    max_open_positions: parseNonNegInt("Max open positions", formData.get("max_open_positions")),
    max_exposure_per_symbol_eur: parseNonNegNumber(
      "Max exposure per symbol (EUR)",
      formData.get("max_exposure_per_symbol_eur"),
    ),
    daily_loss_limit_eur: parseNonNegNumber("Daily loss limit (EUR)", formData.get("daily_loss_limit_eur")),
    max_drawdown_eur: parseNonNegNumber("Max drawdown (EUR)", formData.get("max_drawdown_eur")),
    cooldown_after_losses: parseNonNegInt("Cooldown after losses", formData.get("cooldown_after_losses")),
    allow_add: formData.has("allow_add"),
    mediator_rails_extra: parseMediatorRailsExtra(formData),
    profit_taking_enabled: formData.has("profit_taking_enabled"),
    moving_floor_trail_pct: parseUnitInterval("Moving floor trail percent", formData.get("moving_floor_trail_pct"), false),
    moving_floor_activation_profit_pct: parseUnitInterval(
      "Moving floor activation profit percent",
      formData.get("moving_floor_activation_profit_pct"),
      true,
    ),
    moving_floor_timeframe: String(formData.get("moving_floor_timeframe") ?? "15m").trim() || "15m",
  };
}

type QuoteBudgetRow = {
  quote_asset_id: string;
  max_notional_primary: number;
};

/** Parse paired `quote_budget_quote_asset_id[]` + `quote_budget_max_notional_primary[]` form fields. */
function parseQuoteBudgetRows(formData: FormData): QuoteBudgetRow[] {
  const ids = formData.getAll("quote_budget_quote_asset_id").map((v) => String(v ?? "").trim());
  const amts = formData.getAll("quote_budget_max_notional_primary").map((v) => String(v ?? "").trim());
  if (ids.length !== amts.length) {
    throw new Error("Quote-asset budgets are corrupt (id/amount count mismatch).");
  }
  if (!ids.length) {
    throw new Error("Add at least one quote-asset budget so the executor knows what notional to use per trade.");
  }
  const rows: QuoteBudgetRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] ?? "";
    if (!id) {
      throw new Error("Pick a quote asset for every budget row (or remove empty rows).");
    }
    if (seen.has(id)) {
      throw new Error("Each quote asset can only have one budget row per executor.");
    }
    seen.add(id);
    const amt = Number(amts[i] ?? "");
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error("Each quote-asset budget needs a positive notional in your primary fiat.");
    }
    rows.push({ quote_asset_id: id, max_notional_primary: amt });
  }
  return rows;
}

async function replaceQuoteAssetBudgets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  executorId: string,
  rows: QuoteBudgetRow[],
): Promise<void> {
  // Delete-and-reinsert under the executor-owner RLS policies.
  const { error: delErr } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .delete()
    .eq("executor_id", executorId);
  if (delErr) throw new Error(`Quote-asset budgets: ${delErr.message}`);

  if (!rows.length) return;
  const { error: insErr } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .insert(
      rows.map((r) => ({
        executor_id: executorId,
        quote_asset_id: r.quote_asset_id,
        max_notional_primary: r.max_notional_primary,
      })),
    );
  if (insErr) throw new Error(`Quote-asset budgets: ${insErr.message}`);
}

export async function createExecutor(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");

  const enabled = formData.has("enabled");
  const execution_mode = parseExecutionMode(formData.get("execution_mode"));
  const prevMode = String(formData.get("_previous_execution_mode") ?? "").trim();
  if (execution_mode === "live" && prevMode !== "live" && !formData.has("live_ack")) {
    throw new Error("Confirm live trading before enabling live mode.");
  }

  let asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  let filter_asset_ids = parseAssetIds(formData);
  if (execution_mode === "historical") {
    await assertExchangeIsBitvavo(supabase, parseUuidLike("Exchange", formData.get("exchange_id")));
    asset_filter_mode = "whitelist";
    filter_asset_ids = parseAssetIds(formData);
    if (filter_asset_ids.length !== 1) {
      throw new Error("Historical mode requires exactly one asset in the whitelist.");
    }
  } else if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;
  const rails = mediatorFieldsFromForm(formData);
  const exchange_id = parseUuidLike("Exchange", formData.get("exchange_id"));
  const quoteBudgets = parseQuoteBudgetRows(formData);
  const allowed_sides = parseAllowedSides(formData);
  await assertSidesAllowedByExchange(supabase, exchange_id, allowed_sides);

  let historical_start_date: string | null = null;
  let historical_end_date: string | null = null;
  if (execution_mode === "historical") {
    historical_start_date = parseHistoryDate("Historical start date", formData.get("historical_start_date"));
    historical_end_date = parseHistoryDate("Historical end date", formData.get("historical_end_date"));
    if (historical_start_date > historical_end_date) {
      throw new Error("Historical start date must be on or before the end date.");
    }
  }

  const slack_trade_notifications_enabled =
    execution_mode === "historical" ? false : formData.has("slack_trade_notifications_enabled");

  let exchange_api_key = String(formData.get("exchange_api_key") ?? "").trim();
  let exchange_api_secret = String(formData.get("exchange_api_secret") ?? "").trim();
  if (execution_mode === "live") {
    if (!exchange_api_key || !exchange_api_secret) {
      throw new Error("Live mode requires exchange API key and secret (private REST signing).");
    }
  }

  const { data: inserted, error } = await supabase
    .schema("trading")
    .from("executors")
    .insert({
      user_id: user.id,
      exchange_id,
      name,
      enabled,
      execution_mode,
      asset_filter_mode,
      filter_asset_ids: filterIdsFinal,
      allowed_sides,
      updated_at: new Date().toISOString(),
      slack_trade_notifications_enabled,
      exchange_api_key,
      exchange_api_secret,
      historical_start_date,
      historical_end_date,
      ...rails,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  const newId = inserted?.id as string;
  await ensureRiskStateForExecutor(supabase, { userId: user.id, executorId: newId });
  await replaceQuoteAssetBudgets(supabase, newId, quoteBudgets);
  revalidatePath("/executors");
  redirect(`/executors/${newId}`);
}

function parseBalanceQuantity(formData: FormData, field: string): number {
  const raw = String(formData.get(field) ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Quantity must be a positive number.");
  return n;
}

export async function addExecutorBalance(executorId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assetId = parseUuidLike("Asset", formData.get("asset_id"));
  const quantity = parseBalanceQuantity(formData, "quantity");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await supabase.schema("trading").rpc("apply_wallet_balance_change", {
    p_executor_id: executorId,
    p_kind: "deposit",
    p_asset_id: assetId,
    p_quantity: quantity,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  revalidateExecutorSurface(executorId);
}

export async function removeExecutorBalance(executorId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assetId = parseUuidLike("Asset", formData.get("asset_id"));
  const quantity = parseBalanceQuantity(formData, "quantity");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await supabase.schema("trading").rpc("apply_wallet_balance_change", {
    p_executor_id: executorId,
    p_kind: "withdrawal",
    p_asset_id: assetId,
    p_quantity: quantity,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  revalidateExecutorSurface(executorId);
}

export async function updateExecutor(executorId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");

  const enabled = formData.has("enabled");
  const execution_mode = parseExecutionMode(formData.get("execution_mode"));
  const prevMode = String(formData.get("_previous_execution_mode") ?? "").trim();
  if (execution_mode === "live" && prevMode !== "live" && !formData.has("live_ack")) {
    throw new Error("Confirm live trading before enabling live mode.");
  }

  let asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  let filter_asset_ids = parseAssetIds(formData);
  if (execution_mode === "historical") {
    await assertExchangeIsBitvavo(supabase, parseUuidLike("Exchange", formData.get("exchange_id")));
    asset_filter_mode = "whitelist";
    filter_asset_ids = parseAssetIds(formData);
    if (filter_asset_ids.length !== 1) {
      throw new Error("Historical mode requires exactly one asset in the whitelist.");
    }
  } else if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;
  const rails = mediatorFieldsFromForm(formData);
  const exchange_id = parseUuidLike("Exchange", formData.get("exchange_id"));
  const quoteBudgets = parseQuoteBudgetRows(formData);
  const allowed_sides = parseAllowedSides(formData);
  await assertSidesAllowedByExchange(supabase, exchange_id, allowed_sides);

  let historical_start_date: string | null = null;
  let historical_end_date: string | null = null;
  if (execution_mode === "historical") {
    historical_start_date = parseHistoryDate("Historical start date", formData.get("historical_start_date"));
    historical_end_date = parseHistoryDate("Historical end date", formData.get("historical_end_date"));
    if (historical_start_date > historical_end_date) {
      throw new Error("Historical start date must be on or before the end date.");
    }
  }

  const slack_trade_notifications_enabled =
    execution_mode === "historical" ? false : formData.has("slack_trade_notifications_enabled");

  const { data: curRow, error: curErr } = await supabase
    .schema("trading")
    .from("executors")
    .select("exchange_api_key, exchange_api_secret")
    .eq("id", executorId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (curErr) throw new Error(curErr.message);
  if (!curRow) throw new Error("Executor not found.");

  const formKey = String(formData.get("exchange_api_key") ?? "").trim();
  const formSecret = String(formData.get("exchange_api_secret") ?? "").trim();
  const exchange_api_key = formKey || String((curRow as { exchange_api_key?: string }).exchange_api_key ?? "");
  const exchange_api_secret =
    formSecret || String((curRow as { exchange_api_secret?: string }).exchange_api_secret ?? "");

  if (execution_mode === "live") {
    if (!String(exchange_api_key).trim() || !String(exchange_api_secret).trim()) {
      throw new Error(
        "Live mode requires non-empty exchange API key and secret. Fill both fields or leave unchanged if already stored.",
      );
    }
  }

  const { error } = await supabase
    .schema("trading")
    .from("executors")
    .update({
      name,
      exchange_id,
      enabled,
      execution_mode,
      asset_filter_mode,
      filter_asset_ids: filterIdsFinal,
      allowed_sides,
      updated_at: new Date().toISOString(),
      slack_trade_notifications_enabled,
      exchange_api_key,
      exchange_api_secret,
      historical_start_date,
      historical_end_date,
      ...rails,
    })
    .eq("id", executorId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  await replaceQuoteAssetBudgets(supabase, executorId, quoteBudgets);
  revalidateExecutorSurface(executorId);
}

function revalidateQuoteBudgetSurface(executorId: string) {
  revalidatePath(`/executors/${executorId}`);
  revalidatePath(`/executors/${executorId}/executor-quote-asset-budgets`);
}

function parsePositiveAmount(name: string, raw: FormDataEntryValue | null): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return n;
}

/**
 * Insert a single `trading.executor_quote_asset_budget` row for this executor.
 * Translates the Postgres UNIQUE-violation (23505) into a user-friendly message
 * since the table has UNIQUE(executor_id, quote_asset_id).
 */
export async function createExecutorQuoteBudget(
  executorId: string,
  formData: FormData,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const quote_asset_id = parseUuidLike("Quote asset", formData.get("quote_asset_id"));
  const max_notional_primary = parsePositiveAmount(
    "Max notional",
    formData.get("max_notional_primary"),
  );

  const { error } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .insert({
      executor_id: executorId,
      quote_asset_id,
      max_notional_primary,
    });

  if (error) {
    if (error.code === "23505") {
      throw new Error("A budget for this quote asset already exists on this executor.");
    }
    throw new Error(error.message);
  }

  revalidateQuoteBudgetSurface(executorId);
}

/** Update a single `trading.executor_quote_asset_budget` row by id. */
export async function updateExecutorQuoteBudget(
  budgetId: string,
  executorId: string,
  formData: FormData,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const quote_asset_id = parseUuidLike("Quote asset", formData.get("quote_asset_id"));
  const max_notional_primary = parsePositiveAmount(
    "Max notional",
    formData.get("max_notional_primary"),
  );

  const { error } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .update({ quote_asset_id, max_notional_primary })
    .eq("id", budgetId)
    .eq("executor_id", executorId);

  if (error) {
    if (error.code === "23505") {
      throw new Error("A budget for this quote asset already exists on this executor.");
    }
    throw new Error(error.message);
  }

  revalidateQuoteBudgetSurface(executorId);
}

/** Delete a single `trading.executor_quote_asset_budget` row by id. */
export async function deleteExecutorQuoteBudget(
  budgetId: string,
  executorId: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .schema("trading")
    .from("executor_quote_asset_budget")
    .delete()
    .eq("id", budgetId)
    .eq("executor_id", executorId);

  if (error) throw new Error(error.message);

  revalidateQuoteBudgetSurface(executorId);
}
