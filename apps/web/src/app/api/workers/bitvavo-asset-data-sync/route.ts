import { NextResponse } from "next/server";

import { runBitvavoAssetDataSyncWithSyncRun } from "@/lib/markets/run-bitvavo-asset-data-sync-with-sync-run";
import { sendOpsAlert } from "@/lib/ops/send-ops-alert";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

function parseBody(raw: string): { symbols?: string[] } {
  if (!raw.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(o.symbols)) return {};
    const symbols = o.symbols
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return { symbols: [...new Set(symbols)] };
  } catch {
    return {};
  }
}

async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  try {
    const admin = createServiceRoleClient();
    const bodyOpts = parseBody(rawBody);
    const result = await runBitvavoAssetDataSyncWithSyncRun(admin, "automated", bodyOpts);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    await sendOpsAlert({
      source: "bitvavo-asset-data-sync",
      level: "error",
      title: "Bitvavo asset data sync failed",
      detail: message,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET: Bearer CRON_SECRET — full Bitvavo `/assets` refresh for catalog crypto rows (`sync_runs` `bitvavo_asset_data`).
 */
export async function GET(request: Request) {
  return handle(request, "");
}

/**
 * POST: Bearer CRON_SECRET. Optional JSON `{ "symbols": ["BTC","ETH"] }` to limit updates; omit for all assets from the API.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
