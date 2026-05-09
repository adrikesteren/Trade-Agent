import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { coingeckoSearchCoinId, sleep } from "@/lib/markets/coingecko-client";

function parsePositiveInt(envVal: string | undefined, fallback: number): number {
  if (envVal === undefined || envVal === "") return fallback;
  const n = Number.parseInt(envVal, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

const MAX_SEARCH_PER_RUN = parsePositiveInt(process.env.COINGECKO_COIN_ID_SEARCH_MAX_PER_RUN, 60);
const SEARCH_DELAY_MS = parsePositiveInt(process.env.COINGECKO_SEARCH_DELAY_MS, 1200);

function asRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function coingeckoIdFromMetadata(metadata: unknown): string | null {
  const v = asRecord(metadata).coingecko_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isCoinIdEmpty(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

export type SyncCoingeckoCoinIdResult = {
  copiedFromMetadata: number;
  filledViaSearch: number;
  searchAttempts: number;
  stillMissingCoinId: number;
  failures: string[];
};

/**
 * Ensures `assets.coingecko_coin_id` is set: first copies `metadata.coingecko_id`, then runs CoinGecko /search
 * for remaining crypto rows (capped per invocation).
 */
export async function syncCoingeckoCoinIds(admin: SupabaseClient): Promise<SyncCoingeckoCoinIdResult> {
  const failures: string[] = [];

  const { data: rows, error: selErr } = await admin
    .schema("catalog")
    .from("assets")
    .select("id, code, metadata, coingecko_coin_id")
    .eq("kind", "crypto");

  if (selErr) {
    throw new Error(selErr.message);
  }

  const list = rows ?? [];
  let copiedFromMetadata = 0;

  for (const r of list) {
    if (!isCoinIdEmpty(r.coingecko_coin_id as string | null)) continue;
    const mid = coingeckoIdFromMetadata(r.metadata);
    if (!mid) continue;
    const { error: upErr } = await admin.schema("catalog").from("assets").update({ coingecko_coin_id: mid }).eq("id", r.id);
    if (upErr) {
      failures.push(`${r.code}: ${upErr.message}`);
    } else {
      copiedFromMetadata += 1;
    }
  }

  const { data: rows2, error: sel2Err } = await admin
    .schema("catalog")
    .from("assets")
    .select("id, code, metadata, coingecko_coin_id")
    .eq("kind", "crypto");

  if (sel2Err) {
    throw new Error(sel2Err.message);
  }

  const needSearch = (rows2 ?? []).filter((r) => isCoinIdEmpty(r.coingecko_coin_id as string | null));
  let searchAttempts = 0;
  let filledViaSearch = 0;

  for (const r of needSearch) {
    if (searchAttempts >= MAX_SEARCH_PER_RUN) break;
    searchAttempts += 1;
    try {
      const found = await coingeckoSearchCoinId(r.code as string);
      await sleep(SEARCH_DELAY_MS);
      if (found) {
        const meta = { ...asRecord(r.metadata), coingecko_id: found };
        const { error: upErr } = await admin
          .schema("catalog")
          .from("assets")
          .update({ coingecko_coin_id: found, metadata: meta })
          .eq("id", r.id);
        if (upErr) {
          failures.push(`${r.code}: ${upErr.message}`);
        } else {
          filledViaSearch += 1;
        }
      }
    } catch (e) {
      failures.push(`${r.code}: ${e instanceof Error ? e.message : "search error"}`);
    }
  }

  const { data: finalRows } = await admin.schema("catalog").from("assets").select("coingecko_coin_id").eq("kind", "crypto");
  const stillMissingCoinId = (finalRows ?? []).filter((a) =>
    isCoinIdEmpty(a.coingecko_coin_id as string | null),
  ).length;

  return {
    copiedFromMetadata,
    filledViaSearch,
    searchAttempts,
    stillMissingCoinId,
    failures,
  };
}
