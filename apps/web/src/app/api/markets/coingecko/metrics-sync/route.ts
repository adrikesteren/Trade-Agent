import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  runCoingeckoMetricsSyncWithSyncRun,
  type CoingeckoMetricsSyncBody,
} from "@/lib/agents/ingest/services/coingecko-sync-with-sync-run.service";
import { NextResponse } from "next/server";

/**
 * One-shot CoinGecko metrics sync for catalog crypto assets. Requires logged-in user.
 * POST with ?source=manual from the dashboard (same pattern as Bitvavo markets sync).
 */
export async function POST(request: Request) {
  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("source") !== "manual") {
    return NextResponse.json(
      {
        error: "coingecko_metrics_manual_only",
        hint: "POST with ?source=manual from Sync runs, or use GET/POST /api/workers/coingecko-metrics-sync with CRON_SECRET.",
      },
      { status: 400 },
    );
  }

  let body: CoingeckoMetricsSyncBody = {};
  const text = (await request.text()).trim();
  if (text) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const o = parsed as CoingeckoMetricsSyncBody;
    body = {};
    if (typeof o?.syncRunId === "string" || o?.syncRunId === null) {
      body.syncRunId = o.syncRunId;
    }
  }

  const admin = createServiceRoleClient();
  try {
    const result = await runCoingeckoMetricsSyncWithSyncRun(admin, "manual", body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
