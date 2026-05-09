import "server-only";

import { Client } from "@upstash/qstash";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

export type CoingeckoMetricsContinuationBody = {
  syncRunId: string;
  continuationDepth: number;
};

/**
 * Schedules another POST to the CoinGecko metrics worker (same run id) when resolve/markets work
 * remains after one serverless slice.
 */
export async function queueCoingeckoMetricsContinuation(body: CoingeckoMetricsContinuationBody): Promise<boolean> {
  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (!base || !token) return false;

  const client = new Client({ token });
  await client.publishJSON({
    url: `${base}/api/workers/coingecko-metrics-sync`,
    body,
    retries: 3,
  });
  return true;
}
