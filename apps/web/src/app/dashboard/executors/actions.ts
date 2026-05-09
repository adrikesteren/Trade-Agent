"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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

  const budgetRaw = String(formData.get("budget_eur") ?? "").trim();
  const budget_eur =
    budgetRaw === "" ? null : Number(budgetRaw);
  if (budget_eur != null && (!Number.isFinite(budget_eur) || budget_eur < 0)) {
    throw new Error("Budget must be a non-negative number or empty for unlimited.");
  }

  const asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  const filter_asset_ids = parseAssetIds(formData);
  if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;

  const { data: inserted, error } = await supabase
    .schema("trading")
    .from("executors")
    .insert({
      user_id: user.id,
      name,
      enabled,
      execution_mode,
      budget_eur,
      asset_filter_mode,
      filter_asset_ids: filterIdsFinal,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/executors");
  redirect(`/dashboard/executors/${inserted?.id as string}`);
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

  const budgetRaw = String(formData.get("budget_eur") ?? "").trim();
  const budget_eur = budgetRaw === "" ? null : Number(budgetRaw);
  if (budget_eur != null && (!Number.isFinite(budget_eur) || budget_eur < 0)) {
    throw new Error("Budget must be a non-negative number or empty for unlimited.");
  }

  const asset_filter_mode = parseFilterMode(formData.get("asset_filter_mode"));
  const filter_asset_ids = parseAssetIds(formData);
  if (asset_filter_mode !== "all" && filter_asset_ids.length === 0) {
    throw new Error("Pick at least one asset for whitelist or blacklist mode.");
  }
  const filterIdsFinal = asset_filter_mode === "all" ? [] : filter_asset_ids;

  const { error } = await supabase
    .schema("trading")
    .from("executors")
    .update({
      name,
      enabled,
      execution_mode,
      budget_eur,
      asset_filter_mode,
      filter_asset_ids: filterIdsFinal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", executorId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/executors");
  revalidatePath(`/dashboard/executors/${executorId}`);
}
