import { NextResponse } from "next/server";

import { runSignalsCatalogClose, type SignalsCatalogCloseBody } from "@/lib/signals/run-signals-catalog-close";
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
 * POST: QStash signed callback or `Authorization: Bearer CRON_SECRET` (manual).
 * Computes rule-based signals for one batch of Bitvavo EUR markets at a catalog candle `close_time`.
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

  const parsed = parseBody(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_body", hint: "Expected JSON with closeTimeIso (ISO string)." }, { status: 400 });
  }

  try {
    const result = await runSignalsCatalogClose(parsed);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "signals run failed";
    console.error("[signals-catalog-close] POST failed:", message, e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
