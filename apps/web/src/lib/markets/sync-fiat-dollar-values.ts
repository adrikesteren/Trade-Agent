import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const FRANKFURTER_LATEST = "https://api.frankfurter.app/v1/latest";
const TO_PARAM_CHUNK = 40;

/**
 * Sets `catalog.assets.dollar_value` for fiat rows (USD = 1; others from ECB via Frankfurter, USD base).
 * `rates.EUR` = how many EUR per 1 USD → USD per 1 EUR = `1 / rates.EUR`.
 * Fails soft: network/parse errors return `{ updated: 0 }` without throwing.
 */
export async function syncFiatAssetDollarValues(admin: SupabaseClient): Promise<{ updated: number }> {
  try {
    const { data: fiats, error } = await admin.schema("catalog").from("assets").select("id, code").eq("kind", "fiat");
    if (error) return { updated: 0 };

    const rows = (fiats ?? []) as { id: string; code: string }[];
    if (!rows.length) return { updated: 0 };

    let updated = 0;

    for (const row of rows) {
      const code = String(row.code ?? "").trim().toUpperCase();
      if (!code) continue;
      if (code === "USD") {
        const { error: upErr } = await admin.schema("catalog").from("assets").update({ dollar_value: 1 }).eq("id", row.id);
        if (!upErr) updated += 1;
      }
    }

    const nonUsd = [...new Set(rows.map((r) => String(r.code ?? "").trim().toUpperCase()).filter((c) => c && c !== "USD"))];
    const rateByCode = new Map<string, number>();

    for (let i = 0; i < nonUsd.length; i += TO_PARAM_CHUNK) {
      const chunk = nonUsd.slice(i, i + TO_PARAM_CHUNK);
      const u = new URL(FRANKFURTER_LATEST);
      u.searchParams.set("from", "USD");
      u.searchParams.set("to", chunk.join(","));
      const res = await fetch(u.toString(), { cache: "no-store" });
      if (!res.ok) continue;
      const body = (await res.json()) as { rates?: Record<string, number> };
      const rates = body.rates ?? {};
      for (const [k, v] of Object.entries(rates)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) rateByCode.set(k.toUpperCase(), n);
      }
    }

    for (const row of rows) {
      const code = String(row.code ?? "").trim().toUpperCase();
      if (!code || code === "USD") continue;
      const rate = rateByCode.get(code);
      if (rate == null || !Number.isFinite(rate) || rate <= 0) continue;
      const dollarValue = 1 / rate;
      const { error: upErr } = await admin
        .schema("catalog")
        .from("assets")
        .update({ dollar_value: dollarValue })
        .eq("id", row.id);
      if (!upErr) updated += 1;
    }

    return { updated };
  } catch {
    return { updated: 0 };
  }
}
