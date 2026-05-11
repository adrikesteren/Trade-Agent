import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchBitvavoAssetData as fetchBitvavoAssetsJson,
  type BitvavoAssetDataRow,
} from "@/lib/bitvavo/public/assets";

export type { BitvavoAssetDataRow };

function bitvavoPayloadFromRow(row: BitvavoAssetDataRow): Record<string, unknown> {
  return {
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    depositFee: row.depositFee,
    depositConfirmations: row.depositConfirmations,
    depositStatus: row.depositStatus,
    withdrawalFee: row.withdrawalFee,
    withdrawalMinAmount: row.withdrawalMinAmount,
    withdrawalStatus: row.withdrawalStatus,
    networks: row.networks,
    message: row.message,
    fetchedAt: new Date().toISOString(),
  };
}

function mergeAssetMetadata(existing: unknown, row: BitvavoAssetDataRow): Record<string, unknown> {
  const base =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return {
    ...base,
    bitvavo: bitvavoPayloadFromRow(row),
  };
}

const UPDATE_CONCURRENCY = 25;

export type SyncBitvavoAssetDataOptions = {
  /**
   * Only these base symbols (e.g. `BTC`). If omitted or empty, every asset returned by Bitvavo
   * that has a matching `catalog.assets` row (`kind` = `crypto`) is updated.
   */
  symbols?: string[] | null;
};

export type SyncBitvavoAssetDataResult = {
  /** Rows returned from Bitvavo after optional symbol filter. */
  fetchedFromApi: number;
  /** Rows in `catalog.assets` patched with Bitvavo data + display name. */
  assetsUpdated: number;
  /** Bitvavo symbols with no matching catalog asset (skipped). */
  unmatchedSymbols: number;
};

/**
 * Fetches Bitvavo GET /v2/assets and patches matching `catalog.assets` rows:
 * sets `name` from Bitvavo when present, merges `metadata.bitvavo` with deposit/withdrawal/decimals/networks.
 */
export async function syncBitvavoAssetData(
  supabase: SupabaseClient,
  opts: SyncBitvavoAssetDataOptions = {},
): Promise<SyncBitvavoAssetDataResult> {
  const wanted =
    opts.symbols != null && opts.symbols.length > 0
      ? new Set(
          opts.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
        )
      : null;

  let rows: BitvavoAssetDataRow[];
  if (wanted && wanted.size === 1) {
    const only = [...wanted][0]!;
    rows = await fetchBitvavoAssetsJson({ symbol: only });
  } else {
    rows = await fetchBitvavoAssetsJson();
    if (wanted && wanted.size > 0) {
      rows = rows.filter((r) => wanted.has(String(r.symbol).toUpperCase()));
    }
  }

  const uniqueBySymbol = new Map<string, BitvavoAssetDataRow>();
  for (const r of rows) {
    uniqueBySymbol.set(String(r.symbol).toUpperCase(), r);
  }
  rows = [...uniqueBySymbol.values()];

  if (rows.length === 0) {
    return { fetchedFromApi: 0, assetsUpdated: 0, unmatchedSymbols: 0 };
  }

  const codes = rows.map((r) => String(r.symbol).toUpperCase());

  const { data: assetRows, error: selErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, metadata")
    .eq("kind", "crypto")
    .in("code", codes);

  if (selErr) {
    throw new Error(selErr.message);
  }

  const codeToAsset = new Map(
    (assetRows ?? []).map((a) => [String(a.code).toUpperCase(), a as { id: string; code: string; metadata: unknown }]),
  );

  const work: { id: string; name: string; metadata: Record<string, unknown> }[] = [];
  let unmatchedSymbols = 0;

  for (const row of rows) {
    const code = String(row.symbol).toUpperCase();
    const asset = codeToAsset.get(code);
    if (!asset) {
      unmatchedSymbols += 1;
      continue;
    }
    const name =
      typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : String(asset.code);
    work.push({
      id: asset.id,
      name,
      metadata: mergeAssetMetadata(asset.metadata, row),
    });
  }

  let assetsUpdated = 0;
  for (let i = 0; i < work.length; i += UPDATE_CONCURRENCY) {
    const chunk = work.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (w) => {
        const { error: upErr } = await supabase
          .schema("catalog")
          .from("assets")
          .update({ name: w.name, metadata: w.metadata })
          .eq("id", w.id);
        if (upErr) throw new Error(upErr.message);
      }),
    );
    assetsUpdated += chunk.length;
  }

  return {
    fetchedFromApi: rows.length,
    assetsUpdated,
    unmatchedSymbols,
  };
}
