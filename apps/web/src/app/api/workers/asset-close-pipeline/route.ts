import { NextResponse } from "next/server";

import { runSymbolClosePipeline, type SymbolClosePipelineOptions } from "@/lib/markets/run-symbol-close-pipeline";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/** Same optional skips as symbol-close (both routes share `runSymbolClosePipeline`; CoinGecko is not part of that orchestration). */
function parsePipelineBody(raw: string): Partial<SymbolClosePipelineOptions> {
  if (!raw.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      skipCandles: o.skipCandles === true,
      skipSignals: o.skipSignals === true,
      skipMediator: o.skipMediator === true,
      skipExecutor: o.skipExecutor === true,
    };
  } catch {
    return {};
  }
}

function readQueryParams(url: URL): { assetCode: string | null; exchangeCode: string | null; quote: string | undefined } {
  const assetCode = url.searchParams.get("assetCode")?.trim() ?? null;
  const exchangeCode = url.searchParams.get("exchangeCode")?.trim() ?? null;
  const quoteRaw = url.searchParams.get("quote")?.trim();
  const quote = quoteRaw && quoteRaw.length > 0 ? quoteRaw : undefined;
  return { assetCode, exchangeCode, quote };
}

async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!(await verifyScheduledWorker(request, rawBody))) {
    const devHint =
      process.env.NODE_ENV === "development"
        ? "Use Authorization: Bearer CRON_SECRET."
        : "Invalid or missing worker auth (Bearer CRON_SECRET).";
    return NextResponse.json({ error: "unauthorized", hint: devHint }, { status: 401 });
  }

  const url = new URL(request.url);
  const { assetCode, exchangeCode, quote } = readQueryParams(url);
  if (!assetCode || !exchangeCode) {
    return NextResponse.json(
      { error: "invalid_query", hint: "Required: ?assetCode=…&exchangeCode=… (optional &quote=EUR)." },
      { status: 400 },
    );
  }

  const bodyOpts = parsePipelineBody(rawBody);
  const admin = createServiceRoleClient();
  const result = await runSymbolClosePipeline(admin, {
    assetCode,
    exchangeCode,
    quote,
    ...bodyOpts,
  });

  if (!result.ok && result.syncRunId == null) {
    const beginLock =
      result.resolved.marketId !== "" && result.error?.toLowerCase().includes("another sync");
    return NextResponse.json(result, { status: beginLock ? 409 : 400 });
  }

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}

/**
 * GET: same auth as symbol-close; query `assetCode`, `exchangeCode`, optional `quote` (candles + scoped catalog-close only).
 */
export async function GET(request: Request) {
  return handle(request, "");
}

/**
 * POST: optional JSON skips `skipCandles`, `skipSignals`, `skipMediator`, `skipExecutor` only.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
