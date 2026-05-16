import type { SupabaseClient } from "@supabase/supabase-js";

import { isFiatQuoteCurrencyCode } from "@/lib/markets/fiat-quote-currency-codes";
import * as AssetsSelector from "@/lib/selectors/assets-selector";

/**
 * Load `catalog.assets.id` for Bitvavo-style quote symbols (fiat ISO vs crypto code).
 * Returns only codes that resolved; missing keys mean no matching asset (skip market upsert).
 */
export async function fetchQuoteAssetIdsByCodes(
  supabase: SupabaseClient,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const upper = [...new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, string>();
  if (upper.length === 0) return out;

  const data = await AssetsSelector.selectByCodes(supabase, upper);

  const byCode = new Map<string, { id: string; kind: string }[]>();
  for (const row of data) {
    const code = String(row.code).toUpperCase();
    const list = byCode.get(code) ?? [];
    list.push({ id: row.id as string, kind: String(row.kind) });
    byCode.set(code, list);
  }

  for (const code of upper) {
    const rows = byCode.get(code) ?? [];
    if (isFiatQuoteCurrencyCode(code)) {
      const fiat = rows.find((r) => r.kind === "fiat");
      if (fiat) out.set(code, fiat.id);
    } else {
      const crypto = rows.find((r) => r.kind === "crypto");
      if (crypto) out.set(code, crypto.id);
    }
  }

  return out;
}

export async function resolveQuoteAssetId(supabase: SupabaseClient, quote: string): Promise<string | null> {
  const key = String(quote).trim().toUpperCase();
  if (!key) return null;
  const m = await fetchQuoteAssetIdsByCodes(supabase, [key]);
  return m.get(key) ?? null;
}
