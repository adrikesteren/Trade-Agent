import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as AssetsSelector from "@/lib/selectors/assets-selector";

import type { AssetOption } from "./executor-form";

export type QuoteAssetOptionsByExchange = Record<string, AssetOption[]>;

/**
 * For each exchange, returns the distinct quote assets present on `catalog.markets`
 * for that exchange (id + code, sorted by code). Used by the executor form so the
 * "Quote-asset budgets" editor only offers quotes the chosen exchange actually trades.
 */
export async function fetchQuoteAssetOptionsByExchange(
  supabase: SupabaseClient,
): Promise<QuoteAssetOptionsByExchange> {
  const { data: mrows, error: mErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("exchange_id, quote_asset_id")
    .not("quote_asset_id", "is", null)
    .limit(50_000);
  if (mErr) {
    console.error("quote-asset-options markets:", mErr.message);
    return {};
  }

  const byExchange = new Map<string, Set<string>>();
  for (const row of (mrows ?? []) as { exchange_id: string; quote_asset_id: string }[]) {
    const ex = String(row.exchange_id ?? "").trim();
    const qa = String(row.quote_asset_id ?? "").trim();
    if (!ex || !qa) continue;
    if (!byExchange.has(ex)) byExchange.set(ex, new Set<string>());
    byExchange.get(ex)!.add(qa);
  }

  const allQuoteAssetIds = [...new Set([...byExchange.values()].flatMap((s) => [...s]))];
  if (!allQuoteAssetIds.length) return {};

  let arows: Awaited<ReturnType<typeof AssetsSelector.selectIdCodeByIds>>;
  try {
    arows = await AssetsSelector.selectIdCodeByIds(supabase, allQuoteAssetIds);
  } catch (e) {
    console.error("quote-asset-options assets:", e instanceof Error ? e.message : String(e));
    return {};
  }

  const codeById = new Map<string, string>();
  for (const a of arows) {
    codeById.set(String(a.id), String(a.code ?? ""));
  }

  const out: QuoteAssetOptionsByExchange = {};
  for (const [ex, set] of byExchange.entries()) {
    const list = [...set]
      .map((id) => ({ id, code: codeById.get(id) ?? id.slice(0, 8) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    out[ex] = list;
  }
  return out;
}
