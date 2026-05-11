"use server";

import { revalidatePath } from "next/cache";

import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function asRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
}

/**
 * Sets `catalog.assets.coingecko_coin_id` (and mirrors into `metadata.coingecko_id` when non-empty).
 * Uses service role; caller must be signed in.
 */
export async function setAssetCoingeckoCoinId(assetId: string, coinIdRaw: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must be signed in.");
  }

  const trimmed = coinIdRaw.trim();
  const coingecko_coin_id = trimmed === "" ? null : trimmed;

  const admin = createServiceRoleClient();
  const { data: row, error: selErr } = await admin
    .schema("catalog")
    .from("assets")
    .select("id, kind, metadata")
    .eq("id", assetId)
    .maybeSingle();

  if (selErr) {
    throw new Error(selErr.message);
  }
  if (!row) {
    throw new Error("Asset not found.");
  }
  if (row.kind !== "crypto") {
    throw new Error("Only crypto assets support a CoinGecko coin id.");
  }

  const meta = asRecord(row.metadata);
  if (coingecko_coin_id) {
    meta.coingecko_id = coingecko_coin_id;
  } else {
    delete meta.coingecko_id;
  }

  const { error: upErr } = await admin
    .schema("catalog")
    .from("assets")
    .update({ coingecko_coin_id, metadata: meta })
    .eq("id", assetId);

  if (upErr) {
    throw new Error(upErr.message);
  }

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets");
}
