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

export type UpsertCatalogCryptoAssetsFromBitvavoResult = {
  fetchedFromApi: number;
  assetsUpserted: number;
  inserted: number;
  updated: number;
};

const UPSERT_CODES_CHUNK = 500;
const UPSERT_ROWS_CHUNK = 200;

/**
 * Fetches Bitvavo `GET /v2/assets` and upserts every row into `catalog.assets` (`kind` = `crypto`):
 * `code` = uppercase symbol, `name` from Bitvavo, `metadata.bitvavo` merged (preserves e.g. CoinGecko keys).
 */
export async function upsertCatalogCryptoAssetsFromBitvavo(
  supabase: SupabaseClient,
): Promise<UpsertCatalogCryptoAssetsFromBitvavoResult> {
  let rows = await fetchBitvavoAssetsJson();
  const uniqueBySymbol = new Map<string, BitvavoAssetDataRow>();
  for (const r of rows) {
    uniqueBySymbol.set(String(r.symbol).toUpperCase(), r);
  }
  rows = [...uniqueBySymbol.values()];

  if (rows.length === 0) {
    return { fetchedFromApi: 0, assetsUpserted: 0, inserted: 0, updated: 0 };
  }

  const codes = rows.map((r) => String(r.symbol).toUpperCase());
  const codeToExistingMeta = new Map<string, unknown>();

  for (let i = 0; i < codes.length; i += UPSERT_CODES_CHUNK) {
    const slice = codes.slice(i, i + UPSERT_CODES_CHUNK);
    const { data, error } = await supabase
      .schema("catalog")
      .from("assets")
      .select("code, metadata")
      .eq("kind", "crypto")
      .in("code", slice);

    if (error) {
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      codeToExistingMeta.set(String(row.code).toUpperCase(), row.metadata);
    }
  }

  let inserted = 0;
  let updated = 0;
  const upsertPayload = rows.map((row) => {
    const code = String(row.symbol).toUpperCase();
    if (codeToExistingMeta.has(code)) {
      updated += 1;
    } else {
      inserted += 1;
    }
    const name =
      typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : code;
    const existingMeta = codeToExistingMeta.get(code);
    return {
      kind: "crypto" as const,
      code,
      name,
      metadata: mergeAssetMetadata(existingMeta, row),
    };
  });

  for (let i = 0; i < upsertPayload.length; i += UPSERT_ROWS_CHUNK) {
    const chunk = upsertPayload.slice(i, i + UPSERT_ROWS_CHUNK);
    const { error: upErr } = await supabase.schema("catalog").from("assets").upsert(chunk, {
      onConflict: "kind,code",
    });
    if (upErr) {
      throw new Error(upErr.message);
    }
  }

  return {
    fetchedFromApi: rows.length,
    assetsUpserted: upsertPayload.length,
    inserted,
    updated,
  };
}
