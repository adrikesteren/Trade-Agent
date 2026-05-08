import { Client } from "@upstash/qstash";
import { NextResponse } from "next/server";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  recordBitvavoSyncFailed,
} from "@/lib/markets/record-bitvavo-sync-status";
import { runEurCandleSweep, type EurCandleSweepBody } from "@/lib/markets/run-eur-candle-sweep";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

function parseSweepBody(raw: string): EurCandleSweepBody {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as EurCandleSweepBody;
  } catch {
    return {};
  }
}

/**
 * GET: optional external scheduler with Bearer CRON_SECRET. Enqueues a QStash POST to this path
 * when APP_BASE_URL + QSTASH_TOKEN are set (multi-chunk chain). Not used for localhost-only dev.
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
        hint: "Set APP_BASE_URL (or NEXT_PUBLIC_APP_URL) and QSTASH_TOKEN so the cron can enqueue a signed POST to run the EUR candle sweep.",
      },
      { status: 501 },
    );
  }

  const client = new Client({ token });
  await client.publishJSON({
    url: `${base}/api/workers/bitvavo-candles-sync`,
    body: {},
    retries: 3,
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * POST: QStash (signed) or manual trigger with Bearer CRON_SECRET. Runs up to N candle chunks,
 * then queues the next chunk via QStash until the full EUR sweep completes; then updates
 * `bitvavo_sync_runs` for `bitvavo_candles_eur`.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "QStash callbacks need QSTASH_CURRENT_SIGNING_KEY + QSTASH_NEXT_SIGNING_KEY in this app’s env, or set ALLOW_INSECURE_QSTASH=1 for local-only. Manual POSTs need Authorization: Bearer CRON_SECRET. If you use APP_BASE_URL for QStash, it must match the URL QStash calls (see qstashSigningUrl)."
        : "Invalid or missing QStash signature or Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const body = parseSweepBody(rawBody);

  try {
    const result = await runEurCandleSweep(body);
    return NextResponse.json(result);
  } catch (e) {
    try {
      const admin = createServiceRoleClient();
      await recordBitvavoSyncFailed(admin, {
        runId: body.syncRunId,
        jobKey: BITVAVO_SYNC_JOB_CANDLES_EUR,
        source: body.triggerSource ?? "automated",
      });
    } catch {
      /* non-fatal */
    }
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
