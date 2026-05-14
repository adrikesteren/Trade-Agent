import { createClient } from "@/lib/supabase/server";
import { runEurCandleSweep, type EurCandleSweepBody } from "@/lib/agents/ingest/services/eur-candle-sweep-run.service";
import { NextResponse } from "next/server";

/**
 * Full EUR candle sweep (same engine as POST /api/workers/bitvavo-candles-sync): multi-chunk in one
 * request when possible (full sweep runs inline in the worker). Requires logged-in user.
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
        error: "eur_candles_sweep_manual_only",
        hint: "POST with ?source=manual from Sync runs, or use GET/POST /api/workers/bitvavo-candles-sync with CRON_SECRET.",
      },
      { status: 400 },
    );
  }

  let body: EurCandleSweepBody = {};
  const text = (await request.text()).trim();
  if (text) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as EurCandleSweepBody;
    }
  }

  try {
    const result = await runEurCandleSweep({ ...body, triggerSource: "manual" });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
