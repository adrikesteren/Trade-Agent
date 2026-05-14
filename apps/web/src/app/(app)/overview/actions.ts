"use server";

import { revalidatePath } from "next/cache";

import { executeFindCoingeckoIdWorker } from "@/lib/agents/ingest/services/coingecko-id-find-worker.service";
import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/agents/ingest/services/coingecko-coin-id-sync-with-sync-run.service";
import { runCoingeckoMetricsSyncWithSyncRun } from "@/lib/agents/ingest/services/coingecko-sync-with-sync-run.service";
import { buildFindCoingeckoIdAllWorkerUrl, isRelayWorkerEnqueueConfigured } from "@/lib/relay/relay-symbol-close-pipeline-client";
import { upsertCatalogCryptoAssetsFromBitvavo } from "@/lib/agents/ingest/services/bitvavo-asset-data-sync.service";
import { upsertBitvavoMarketsForExistingAssets } from "@/lib/agents/ingest/services/bitvavo-markets-sync.service";
import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RetrieveBitvavoCatalogAssetsResult =
  | {
      ok: true;
      fetchedFromApi: number;
      assetsUpserted: number;
      inserted: number;
      updated: number;
    }
  | { ok: false; error: string };

export async function retrieveBitvavoCatalogAssets(): Promise<RetrieveBitvavoCatalogAssetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await upsertCatalogCryptoAssetsFromBitvavo(admin);
    revalidatePath("/overview");
    revalidatePath("/assets");
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type SyncCoingeckoCoinIdsFromOverviewResult =
  | {
      ok: true;
      via: "relay";
      published: number;
      distinctAssetCodes: string[];
      relayMessageIds: string[];
      relayMessageGroupIds?: string[];
    }
  | {
      ok: true;
      via: "inline";
      copiedFromMetadata: number;
      filledViaSearch: number;
      searchAttempts: number;
      stillMissingCoinId: number;
      tasksCreated: number;
      failureCount: number;
      syncRunId: string | null;
    }
  | { ok: false; error: string };

/**
 * When Relay + worker env is configured, enqueues a Relay **message-group** (one job per eligible asset) for
 * `POST /api/workers/assets/find-coingecko-id?assetCode=…`. Otherwise runs the capped inline sync in-process.
 */
export async function syncCoingeckoCoinIdsFromOverview(): Promise<SyncCoingeckoCoinIdsFromOverviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  if (await isRelayWorkerEnqueueConfigured()) {
    try {
      const appBase = getAppBaseUrl();
      const url = buildFindCoingeckoIdAllWorkerUrl(appBase, "manual");
      const body = await executeFindCoingeckoIdWorker(url);
      if (!body.ok) {
        return { ok: false, error: "error" in body ? body.error : "Relay enqueue failed." };
      }
      if (body.mode !== "relay_enqueued") {
        return { ok: false, error: "Unexpected worker response (expected relay_enqueued)." };
      }
      revalidatePath("/overview");
      revalidatePath("/assets");
      return {
        ok: true,
        via: "relay",
        published: body.published,
        distinctAssetCodes: body.distinctAssetCodes,
        relayMessageIds: body.relayMessageIds ?? [],
        relayMessageGroupIds: body.relayMessageGroupIds,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error.";
      return { ok: false, error: msg };
    }
  }

  try {
    const admin = createServiceRoleClient();
    const r = await runCoingeckoCoinIdSyncWithSyncRun(admin, "manual");
    revalidatePath("/overview");
    revalidatePath("/assets");
    revalidatePath("/sync-runs");
    revalidatePath("/tasks");
    return {
      ok: true,
      via: "inline",
      copiedFromMetadata: r.copiedFromMetadata,
      filledViaSearch: r.filledViaSearch,
      searchAttempts: r.searchAttempts,
      stillMissingCoinId: r.stillMissingCoinId,
      tasksCreated: r.tasksCreated,
      failureCount: r.failures.length,
      syncRunId: r.syncRunId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type SyncCoingeckoMetricsFromOverviewResult =
  | {
      ok: true;
      assetsConsidered: number;
      resolvedThisRun: number;
      assetsUpdated: number;
      stillMissingCoingeckoId: number;
      searchAttemptsThisRun: number;
      searchFailureCount: number;
      syncRunId: string | null;
      fiatDollarValuesUpdated: number;
    }
  | { ok: false; error: string };

/** Same job as `POST /api/markets/coingecko/metrics-sync?source=manual`: live USD metrics on `catalog.assets`. */
export async function syncCoingeckoMetricsFromOverview(): Promise<SyncCoingeckoMetricsFromOverviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await runCoingeckoMetricsSyncWithSyncRun(admin, "manual", {});
    revalidatePath("/overview");
    revalidatePath("/assets");
    revalidatePath("/markets");
    revalidatePath("/sync-runs");
    return {
      ok: true,
      assetsConsidered: r.assetsConsidered,
      resolvedThisRun: r.resolvedThisRun,
      assetsUpdated: r.assetsUpdated,
      stillMissingCoingeckoId: r.stillMissingCoingeckoId,
      searchAttemptsThisRun: r.searchAttemptsThisRun,
      searchFailureCount: r.searchFailures.length,
      syncRunId: r.syncRunId,
      fiatDollarValuesUpdated: r.fiatDollarValuesUpdated,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type RetrieveBitvavoMarketsResult =
  | {
      ok: true;
      fetchedFromApi: number;
      tradingMarkets: number;
      marketsUpserted: number;
      skippedMissingAsset: number;
      skippedMissingQuote: number;
    }
  | { ok: false; error: string };

/** Upserts Bitvavo markets only when `asset.code` matches the pair base (no new assets). */
export async function retrieveBitvavoMarketsLinkedToAssets(): Promise<RetrieveBitvavoMarketsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await upsertBitvavoMarketsForExistingAssets(admin, { quoteFilter: null });
    revalidatePath("/overview");
    revalidatePath("/markets");
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}
