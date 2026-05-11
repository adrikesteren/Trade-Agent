"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ensureRiskStateForExecutor } from "@/lib/trading/executors";

function revalidateExecutorSurface(executorId: string) {
  revalidatePath("/executors");
  revalidatePath(`/executors/${executorId}`);
  revalidatePath(`/executors/${executorId}/orders`);
  revalidatePath(`/executors/${executorId}/trade-decisions`);
  revalidatePath(`/executors/${executorId}/positions`);
}

export type ExecutorAssetFilterMode = "all" | "whitelist" | "blacklist";
export type ExecutionModeValue = "paper" | "live";

function parseFilterMode(raw: FormDataEntryValue | null): ExecutorAssetFilterMode {
  const s = String(raw ?? "").trim();
  if (s === "whitelist" || s === "blacklist" || s === "all") return s;
  return "all";
}

function parseExecutionMode(raw: FormDataEntryValue | null): ExecutionModeValue {
  const s = String(raw ?? "").trim();
  if (s === "live" || s === "paper") return s;
  return "paper";
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

function parsePositiveFinite(name: string, raw: FormDataEntryValue | null): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
  return n;
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
    default_notional_eur: parsePositiveFinite("Default notional (EUR)", formData.get("default_notional_eur")),
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

  const asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  const filter_asset_ids = parseAssetIds(formData);
  if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;
  const rails = mediatorFieldsFromForm(formData);
  const exchange_id = parseUuidLike("Exchange", formData.get("exchange_id"));

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
      updated_at: new Date().toISOString(),
      ...rails,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  const newId = inserted?.id as string;
  await ensureRiskStateForExecutor(supabase, { userId: user.id, executorId: newId });
  revalidatePath("/executors");
  redirect(`/executors/${newId}`);
}

function parseBalanceAmount(formData: FormData, field: string): number {
  const raw = String(formData.get(field) ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be a positive number.");
  return n;
}

export async function addExecutorBalance(executorId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureRiskStateForExecutor(supabase, { userId: user.id, executorId });

  const amount = parseBalanceAmount(formData, "amount_eur");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await supabase.schema("trading").rpc("apply_executor_balance_change", {
    p_executor_id: executorId,
    p_kind: "deposit",
    p_amount_eur: amount,
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

  await ensureRiskStateForExecutor(supabase, { userId: user.id, executorId });

  const amount = parseBalanceAmount(formData, "amount_eur");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { error } = await supabase.schema("trading").rpc("apply_executor_balance_change", {
    p_executor_id: executorId,
    p_kind: "withdrawal",
    p_amount_eur: amount,
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

  const asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  const filter_asset_ids = parseAssetIds(formData);
  if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;
  const rails = mediatorFieldsFromForm(formData);
  const exchange_id = parseUuidLike("Exchange", formData.get("exchange_id"));

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
      updated_at: new Date().toISOString(),
      ...rails,
    })
    .eq("id", executorId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidateExecutorSurface(executorId);
}
