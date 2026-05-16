"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import {
  buildFindCoingeckoIdWorkerUrl,
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  makeRelayClient,
  relayMaxRetries,
  toRelayOriginAndPath,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import { JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID } from "@/lib/tasks/constants";
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
  const row = await AssetsSelector.selectEditById(admin, assetId);

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

  await AssetsSelector.updateCoingeckoCoinIdAndMetadataById(admin, assetId, {
    coingecko_coin_id,
    metadata: meta,
  });

  const codeSeg = encodeURIComponent(String(row.code ?? "").trim());
  revalidatePath(`/assets/${assetId}`);
  if (codeSeg) {
    revalidatePath(`/assets/${codeSeg}`);
  }
  revalidatePath("/assets");
  revalidatePath("/tasks");
}

export type EnqueueFindCoingeckoIdForAssetViaRelayResult =
  | { ok: true; relayMessageId: string }
  | { ok: false; error: string };

/**
 * Enqueues a single Relay job: `POST …/api/workers/assets/find-coingecko-id?assetCode=<code>&source=manual`.
 * Requires Relay + `APP_URL` + worker cron secret (same as other worker enqueue paths).
 */
export async function enqueueFindCoingeckoIdForAssetViaRelay(
  assetId: string,
): Promise<EnqueueFindCoingeckoIdForAssetViaRelayResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  if (!(await isRelayWorkerEnqueueConfigured())) {
    return {
      ok: false,
      error:
        "Relay is not configured. Set RELAY_APP_URL, RELAY_APP_SECRET, APP_URL, and worker cron secret (public.system_settings cron_secret or CRON_SECRET).",
    };
  }

  const admin = createServiceRoleClient();
  let row: Awaited<ReturnType<typeof AssetsSelector.selectFindCoinIdRowById>>;
  try {
    row = await AssetsSelector.selectFindCoinIdRowById(admin, assetId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!row) {
    return { ok: false, error: "Asset not found." };
  }
  if (row.kind !== "crypto") {
    return { ok: false, error: "Only crypto assets support CoinGecko coin id discovery." };
  }

  const existing = typeof row.coingecko_coin_id === "string" ? row.coingecko_coin_id.trim() : "";
  if (existing) {
    return { ok: false, error: "This asset already has a CoinGecko coin id." };
  }

  const { data: skipRow } = await admin
    .from("tasks")
    .select("id")
    .eq("related_schema", "catalog")
    .eq("related_table", "assets")
    .eq("related_id", assetId)
    .eq("status", "open")
    .eq("job_identifier", JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID)
    .maybeSingle();

  if (skipRow?.id) {
    return {
      ok: false,
      error:
        "Automatic CoinGecko lookup is skipped for this asset while an open task with job skip_auto_coingecko_coin_id exists. Resolve or complete that task, or set the coin id manually.",
    };
  }

  try {
    const relay = makeRelayClient();
    const appBase = getAppBaseUrl();
    const { origin, path } = toRelayOriginAndPath(buildFindCoingeckoIdWorkerUrl(appBase, String(row.code), "manual"));
    const { message } = await relay.messages.enqueue({
      origin,
      path,
      method: "POST",
      headers: await downstreamWorkerHeaders(),
      maxRetries: relayMaxRetries(),
    });
    return { ok: true, relayMessageId: message.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type DeleteCatalogAssetResult = { ok: true } | { ok: false; error: string };

/**
 * Removes a catalog asset (service role). Blocked when any market still references it as base or quote.
 */
export async function deleteCatalogAsset(assetId: string): Promise<DeleteCatalogAssetResult> {
  const id = assetId.trim();
  if (!id) {
    return { ok: false, error: "Invalid asset." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createServiceRoleClient();

  const { count: baseCount, error: baseErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("*", { count: "exact", head: true })
    .eq("asset_id", id);

  if (baseErr) {
    return { ok: false, error: baseErr.message };
  }

  const { count: quoteCount, error: quoteErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("*", { count: "exact", head: true })
    .eq("quote_asset_id", id);

  if (quoteErr) {
    return { ok: false, error: quoteErr.message };
  }

  const asBase = baseCount ?? 0;
  const asQuote = quoteCount ?? 0;
  if (asBase > 0 || asQuote > 0) {
    return {
      ok: false,
      error: `This asset is still used by ${asBase} market(s) as base and ${asQuote} as quote. Remove or reassign those markets first.`,
    };
  }

  let row: Awaited<ReturnType<typeof AssetsSelector.selectIdCodeById>>;
  try {
    row = await AssetsSelector.selectIdCodeById(admin, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!row) {
    return { ok: false, error: "Asset not found." };
  }

  let deleted: { id: string }[];
  try {
    deleted = await AssetsSelector.deleteByIdReturningIds(admin, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!deleted.length) {
    return { ok: false, error: "Delete had no effect." };
  }

  const codeSeg = encodeURIComponent(String(row.code ?? "").trim());
  revalidatePath("/assets");
  revalidatePath(`/assets/${id}`);
  if (codeSeg) {
    revalidatePath(`/assets/${codeSeg}`);
  }
  revalidatePath("/markets");
  revalidatePath("/overview");

  return { ok: true };
}
