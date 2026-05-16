import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import {
  buildFindCoingeckoIdWorkerUrl,
  downstreamWorkerHeaders,
  makeRelayClient,
  relayMaxRetries,
  toRelayOriginAndPath,
  toRelayOriginAndPaths,
} from "@/lib/relay/relay-symbol-close-pipeline-client";

import type { RelayClient } from "@adrikesteren/relay-client";
import { JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID } from "@/lib/tasks/constants";

import { listCryptoAssetsNeedingCoinIdSearch } from "@/lib/agents/ingest/services/coingecko-coin-id-sync.service";

export type PublishCoingeckoFindIdRelayFailure = { assetCode: string; message: string };

export type PublishCoingeckoFindIdRelayResult = {
  ok: boolean;
  published: number;
  distinctAssetCodes: string[];
  relayMessageIds?: string[];
  relayMessageGroupIds?: string[];
  failures: PublishCoingeckoFindIdRelayFailure[];
  error?: string;
};

/**
 * Enqueues one Relay job per eligible catalog crypto asset (empty `coingecko_coin_id`, no open skip task).
 */
export async function publishCoingeckoFindIdRelayJobs(
  admin: SupabaseClient,
  source: "manual" | "automated",
): Promise<PublishCoingeckoFindIdRelayResult> {
  const { rows, error: listErr } = await listCryptoAssetsNeedingCoinIdSearch(admin);
  if (listErr) {
    return {
      ok: false,
      published: 0,
      distinctAssetCodes: [],
      failures: [],
      error: listErr,
    };
  }

  const distinctAssetCodes: string[] = [];
  for (const r of rows) {
    const { data: skipRow, error: skipErr } = await admin
      .from("tasks")
      .select("id")
      .eq("related_schema", "catalog")
      .eq("related_table", "assets")
      .eq("related_id", r.id)
      .eq("status", "open")
      .eq("job_identifier", JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID)
      .maybeSingle();

    if (skipErr) {
      return {
        ok: false,
        published: 0,
        distinctAssetCodes: [],
        failures: [{ assetCode: String(r.code), message: skipErr.message }],
        error: skipErr.message,
      };
    }
    if (skipRow?.id) continue;
    distinctAssetCodes.push(String(r.code).trim());
  }

  if (distinctAssetCodes.length === 0) {
    return { ok: true, published: 0, distinctAssetCodes: [], failures: [] };
  }

  let relay: RelayClient;
  let appBase: string;
  let workerHeaders: Record<string, string>;
  let maxRetries: number;
  try {
    relay = makeRelayClient();
    appBase = getAppBaseUrl();
    workerHeaders = await downstreamWorkerHeaders();
    maxRetries = relayMaxRetries();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      published: 0,
      distinctAssetCodes,
      failures: [],
      error: msg,
    };
  }

  const urls = distinctAssetCodes.map((code) => buildFindCoingeckoIdWorkerUrl(appBase, code, source));
  const relayMessageIds: string[] = [];
  const relayMessageGroupIds: string[] = [];

  try {
    if (urls.length === 1) {
      const { origin, path } = toRelayOriginAndPath(urls[0]!);
      const { message } = await relay.messages.enqueue({
        origin,
        path,
        method: "POST",
        headers: workerHeaders,
        maxRetries,
      });
      relayMessageIds.push(message.id);
    } else {
      const { origin, paths } = toRelayOriginAndPaths(urls);
      const { message_group, messages } = await relay.messageGroups.create({
        origin,
        paths,
        method: "POST",
        headers: workerHeaders,
        maxRetries,
      });
      relayMessageGroupIds.push(message_group.id);
      relayMessageIds.push(...messages.map((m) => m.id));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      published: 0,
      distinctAssetCodes,
      failures: [{ assetCode: "_relay", message: msg }],
      error: msg,
      relayMessageIds: relayMessageIds.length ? relayMessageIds : undefined,
      relayMessageGroupIds: relayMessageGroupIds.length ? relayMessageGroupIds : undefined,
    };
  }

  return {
    ok: true,
    published: distinctAssetCodes.length,
    distinctAssetCodes,
    relayMessageIds,
    relayMessageGroupIds: relayMessageGroupIds.length ? relayMessageGroupIds : undefined,
    failures: [],
  };
}
