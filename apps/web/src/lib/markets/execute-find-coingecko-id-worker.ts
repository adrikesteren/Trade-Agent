import "server-only";

import type { BitvavoSyncTriggerSource } from "@/lib/markets/record-bitvavo-sync-status";
import { publishCoingeckoFindIdRelayJobs } from "@/lib/markets/publish-coingecko-find-id-relay";
import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run";
import { syncCoingeckoCoinIdForAssetByCode } from "@/lib/markets/sync-coingecko-coin-id";
import { isRelayWorkerEnqueueConfigured } from "@/lib/relay/relay-symbol-close-pipeline-client";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type FindCoingeckoIdWorkerJson =
  | {
      ok: true;
      mode: "relay_enqueued";
      published: number;
      distinctAssetCodes: string[];
      relayMessageIds?: string[];
      relayMessageGroupIds?: string[];
      failures: { assetCode: string; message: string }[];
    }
  | ({
      ok: true;
      mode: "inline_bulk";
    } & Awaited<ReturnType<typeof runCoingeckoCoinIdSyncWithSyncRun>>)
  | {
      ok: true;
      mode: "inline_single";
      result: Awaited<ReturnType<typeof syncCoingeckoCoinIdForAssetByCode>>;
    }
  | { ok: false; error: string };

function parseSource(u: URL): BitvavoSyncTriggerSource {
  if (u.searchParams.get("source") === "manual") return "manual";
  return "automated";
}

/**
 * Shared implementation for `GET/POST /api/workers/assets/find-coingecko-id` (and legacy shims).
 */
export async function executeFindCoingeckoIdWorker(requestUrl: string): Promise<FindCoingeckoIdWorkerJson> {
  const u = new URL(requestUrl);
  const source = parseSource(u);
  const all = u.searchParams.get("all") === "true";
  const assetCode = u.searchParams.get("assetCode")?.trim() || null;

  if (all === Boolean(assetCode)) {
    return {
      ok: false,
      error: "Provide exactly one of: ?all=true or ?assetCode=<catalog asset code>",
    };
  }

  const admin = createServiceRoleClient();

  if (all) {
    if (await isRelayWorkerEnqueueConfigured()) {
      const pub = await publishCoingeckoFindIdRelayJobs(admin, source);
      if (!pub.ok) {
        return { ok: false, error: pub.error ?? "relay_publish_failed" };
      }
      return {
        ok: true,
        mode: "relay_enqueued",
        published: pub.published,
        distinctAssetCodes: pub.distinctAssetCodes,
        relayMessageIds: pub.relayMessageIds,
        relayMessageGroupIds: pub.relayMessageGroupIds,
        failures: pub.failures,
      };
    }
    const bulk = await runCoingeckoCoinIdSyncWithSyncRun(admin, source);
    return { ok: true, mode: "inline_bulk", ...bulk };
  }

  const result = await syncCoingeckoCoinIdForAssetByCode(admin, assetCode!);
  return {
    ok: true,
    mode: "inline_single",
    result,
  };
}
