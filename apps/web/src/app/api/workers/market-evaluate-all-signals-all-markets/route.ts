import { NextResponse } from "next/server";

import { runMarketEvaluateAllSignalsAcrossMarkets } from "@/lib/agents/signal/services/market-evaluate-all-signals-across-markets.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * Re-evaluate signals across **every market with at least one stored candle**.
 *
 * Intended for one-off batch operations after an agent's seed config changes.
 * Pass `?forceAgentSlugs=regime-classifier-15m-v1` to overwrite the regime
 * rows in place (preserves signal id; downstream FK survives).
 *
 * Optional query params:
 *   - `forceAgentSlugs=slug1,slug2`   — comma-separated slugs to force-overwrite
 *   - `perMarketBudgetMs=60000`       — per-market wall-clock cap (defaults to 60s)
 *   - `overallBudgetMs=540000`        — outer loop wall-clock cap (defaults to 9min)
 *   - `onlyMarketIds=uuid1,uuid2`     — restrict to a whitelist
 *
 * Returns `{ ok, marketsConsidered, marketsProcessed, marketsFailed, ... }`.
 * On `deadlineHit: true` the caller can simply re-invoke to resume; per-market
 * skip-existing means already-rewritten rows aren't touched again.
 */
async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const url = new URL(request.url);

  const forceAgentSlugs = (url.searchParams.get("forceAgentSlugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const perMarketBudgetMs = (() => {
    const raw = url.searchParams.get("perMarketBudgetMs");
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const overallBudgetMs = (() => {
    const raw = url.searchParams.get("overallBudgetMs");
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const onlyMarketIds = (url.searchParams.get("onlyMarketIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const admin = createServiceRoleClient();
    const result = await runMarketEvaluateAllSignalsAcrossMarkets(admin, {
      ...(forceAgentSlugs.length > 0 ? { forceAgentSlugs } : {}),
      ...(perMarketBudgetMs != null ? { perMarketBudgetMs } : {}),
      ...(overallBudgetMs != null ? { overallBudgetMs } : {}),
      ...(onlyMarketIds.length > 0 ? { onlyMarketIds } : {}),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "evaluate all markets failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request, "");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
