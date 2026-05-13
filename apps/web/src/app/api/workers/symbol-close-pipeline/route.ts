import { NextResponse } from "next/server";

import { runSymbolClosePipeline, type SymbolClosePipelineOptions } from "@/lib/markets/run-symbol-close-pipeline";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

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
        ? "Use Authorization: Bearer <secret> matching public.system_settings key cron_secret (JSON string) or CRON_SECRET env."
        : "Invalid or missing worker auth (Bearer must match cron_secret in public.system_settings or CRON_SECRET env).";
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
 * GET: Bearer CRON_SECRET; same as POST with empty body; query params `assetCode`, `exchangeCode`, optional `quote`.
 */
export async function GET(request: Request) {
  return handle(request, "");
}

/**
 * POST: Bearer CRON_SECRET. Optional JSON body: `skipCandles`, `skipSignals`, `skipMediator`, `skipExecutor` (all booleans, default false).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
