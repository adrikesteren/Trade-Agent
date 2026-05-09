import { Client } from "@upstash/qstash";
import { NextResponse } from "next/server";
import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

/**
 * GET: Bearer CRON_SECRET — enqueue QStash POST (same pattern as other catalog workers).
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
        hint: "Set APP_BASE_URL (or NEXT_PUBLIC_APP_URL) and QSTASH_TOKEN to enqueue CoinGecko coin-id sync.",
      },
      { status: 501 },
    );
  }

  const client = new Client({ token });
  await client.publishJSON({
    url: `${base}/api/workers/coingecko-coin-id-sync`,
    body: {},
    retries: 3,
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * POST: QStash signed callback or Bearer CRON_SECRET — fills `assets.coingecko_coin_id` when empty.
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

  try {
    const admin = createServiceRoleClient();
    const result = await runCoingeckoCoinIdSyncWithSyncRun(admin, "automated");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
