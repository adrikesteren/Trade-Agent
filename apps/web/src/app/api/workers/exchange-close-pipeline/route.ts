import { NextResponse } from "next/server";

import { runExchangeClosePipeline } from "@/lib/orchestrators/exchange-close-pipeline.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

function readQuery(url: URL): { exchangeCode: string | null; quote: string | undefined } {
  const exchangeCode = url.searchParams.get("exchangeCode")?.trim() ?? null;
  const quoteRaw = url.searchParams.get("quote")?.trim();
  const quote = quoteRaw && quoteRaw.length > 0 ? quoteRaw : undefined;
  return { exchangeCode, quote };
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
  const { exchangeCode, quote } = readQuery(url);
  if (!exchangeCode) {
    return NextResponse.json(
      { error: "invalid_query", hint: "Required: ?exchangeCode=… (optional &quote=EUR)." },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  const result = await runExchangeClosePipeline(admin, { exchangeCode, quote });

  if (!result.ok && result.distinctAssetCodes.length === 0 && result.published === 0) {
    const status =
      result.error === "unknown_exchange_code" || result.error === "ambiguous_exchange_code" ? 404 : 400;
    return NextResponse.json(result, { status });
  }

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}

/**
 * GET: same auth as POST; query `exchangeCode`, optional `quote` (default EUR in pipeline).
 */
export async function GET(request: Request) {
  return handle(request, "");
}

/** POST: empty body is fine; same query params as GET. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  return handle(request, rawBody);
}
