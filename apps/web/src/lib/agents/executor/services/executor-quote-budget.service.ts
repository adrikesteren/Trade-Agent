import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { primaryUnitsToQuoteUnits } from "@/lib/catalog/primary-to-quote";
import * as AssetsSelector from "@/lib/selectors/assets-selector";

/**
 * Resolve the per-trade notional for an executor + quote asset, expressed in **quote-asset units**.
 *
 * Returns:
 *   - a positive number: notional that the mediator should pass as `notionalEurSuggested` (name kept for now)
 *   - `null`: no junction row for this (executor, quote_asset_id) → caller should skip with reason
 *     `quote_asset_not_allowed`. Also returned when the dollar_value triangulation cannot be done
 *     (missing/zero dollar_value on the primary or quote fiat).
 */
export async function fetchExecutorQuoteBudgetInQuoteUnits(
  admin: SupabaseClient,
  args: {
    executorId: string;
    quoteAssetId: string;
  },
): Promise<number | null> {
  const executorId = String(args.executorId ?? "").trim();
  const quoteAssetId = String(args.quoteAssetId ?? "").trim();
  if (!executorId || !quoteAssetId) return null;

  // Load junction row + executor.user_id (used to find the owner's primary asset).
  const { data: budgetRow, error: bErr } = await admin
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("max_notional_primary, executor_id, quote_asset_id, executors:executor_id ( user_id )")
    .eq("executor_id", executorId)
    .eq("quote_asset_id", quoteAssetId)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!budgetRow) return null;

  const maxPrimary = Number((budgetRow as { max_notional_primary?: unknown }).max_notional_primary);
  if (!Number.isFinite(maxPrimary) || maxPrimary <= 0) return null;

  // Resolve ownerId
  const exJoin = (budgetRow as { executors?: { user_id?: string } | { user_id?: string }[] }).executors;
  const exObj = Array.isArray(exJoin) ? exJoin[0] : exJoin;
  const ownerId = String(exObj?.user_id ?? "").trim();
  if (!ownerId) return null;

  // Owner's primary asset id
  const { data: prefRow, error: pErr } = await admin
    .from("user_preferences")
    .select("primary_asset_id")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  const primaryAssetId = String((prefRow as { primary_asset_id?: string } | null)?.primary_asset_id ?? "").trim();
  if (!primaryAssetId) return null;

  // Same fiat as the market quote → just return the number stored as primary units (no conversion needed)
  if (primaryAssetId === quoteAssetId) {
    return maxPrimary;
  }

  // Read both dollar_values for triangulation
  const dvRows = await AssetsSelector.selectIdDollarValueByIds(admin, [primaryAssetId, quoteAssetId]);

  const byId = new Map<string, number | null>();
  for (const row of dvRows) {
    const raw = row.dollar_value;
    const n = raw == null ? null : typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    byId.set(String(row.id), Number.isFinite(n) && (n as number) > 0 ? (n as number) : null);
  }

  return primaryUnitsToQuoteUnits({
    primaryAmount: maxPrimary,
    primaryDollarValue: byId.get(primaryAssetId) ?? null,
    quoteDollarValue: byId.get(quoteAssetId) ?? null,
  });
}
