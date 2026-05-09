import { Client } from "@upstash/qstash";
import { NextResponse } from "next/server";
import {
  runCoingeckoMetricsSyncWithSyncRun,
  type CoingeckoMetricsSyncBody,
} from "@/lib/markets/run-coingecko-sync-with-sync-run";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

/**
 * GET: trusted caller with Authorization: Bearer CRON_SECRET (e.g. Vercel Cron). Always enqueues a signed QStash POST
 * to this path — same pattern as Bitvavo EUR candles worker (no long inline run on the cron request).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (!base || !token) {
    return NextResponse.json(
      {
        error: "missing_config",
        hint: "Set APP_BASE_URL (or NEXT_PUBLIC_APP_URL) and QSTASH_TOKEN so the cron can enqueue a signed POST to run CoinGecko metrics sync.",
      },
      { status: 501 },
    );
  }

  const client = new Client({ token });
  await client.publishJSON({
    url: `${base}/api/workers/coingecko-metrics-sync`,
    body: {},
    retries: 3,
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * POST: QStash signed callback or `Authorization: Bearer CRON_SECRET` (manual). Runs sync inline.
 * Body optional: `{ "syncRunId": "<uuid>" }` to attach to an existing run (same idea as candle `syncRunId` across chunks).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET, or QStash signing keys + APP_BASE_URL, or ALLOW_INSECURE_QSTASH=1 for local."
        : "Invalid or missing QStash signature or Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  let body: CoingeckoMetricsSyncBody = {};
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as {
        syncRunId?: string | null;
        continuationDepth?: number;
      };
      if (typeof parsed?.syncRunId === "string" || parsed?.syncRunId === null) {
        body.syncRunId = parsed.syncRunId;
      }
      if (typeof parsed?.continuationDepth === "number" && Number.isFinite(parsed.continuationDepth)) {
        body.continuationDepth = Math.max(0, Math.floor(parsed.continuationDepth));
      }
    } catch {
      /* ignore invalid JSON; treat as empty body */
    }
  }

  try {
    const admin = createServiceRoleClient();
    const result = await runCoingeckoMetricsSyncWithSyncRun(admin, "automated", body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
