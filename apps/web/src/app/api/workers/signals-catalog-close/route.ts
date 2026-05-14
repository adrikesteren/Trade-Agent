import { NextResponse } from "next/server";

import { executeSignalsCatalogCloseWithSyncRun } from "@/lib/agents/signal/services/signals-catalog-close-with-sync-run.service";
import type { SignalsCatalogCloseBody } from "@/lib/agents/signal/services/signals-catalog-close-run.service";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

function parseBody(raw: string): SignalsCatalogCloseBody | null {
  if (!raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const closeTimeIso = o.closeTimeIso;
    if (typeof closeTimeIso !== "string" || !closeTimeIso.trim()) return null;
    return {
      closeTimeIso: closeTimeIso.trim(),
      timeframe: typeof o.timeframe === "string" ? o.timeframe : undefined,
      quote: o.quote === null ? null : typeof o.quote === "string" ? o.quote : undefined,
      marketOffset: typeof o.marketOffset === "number" ? o.marketOffset : undefined,
      marketBatchSize: typeof o.marketBatchSize === "number" ? o.marketBatchSize : undefined,
      candleSyncRunId:
        typeof o.candleSyncRunId === "string" || o.candleSyncRunId === null ? (o.candleSyncRunId as string | null) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * POST: Bearer CRON_SECRET. Full signals pass for one catalog bar (`automation.sync_runs` job `signals_catalog_close`).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing Authorization: Bearer CRON_SECRET.";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const parsed = parseBody(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_body", hint: "Expected JSON with closeTimeIso (ISO string)." }, { status: 400 });
  }

  try {
    const out = await executeSignalsCatalogCloseWithSyncRun(parsed, "manual");
    if (out.kind === "skipped_overlap") {
      return NextResponse.json({ ok: true, skipped: true, syncRunId: out.runId, hint: "Another signals_catalog_close run is already in progress." });
    }
    return NextResponse.json({ ...out.result, syncRunId: out.runId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "signals run failed";
    console.error("[signals-catalog-close] POST failed:", message, e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
