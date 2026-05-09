import "server-only";

import { Client } from "@upstash/qstash";
import type { SupabaseClient } from "@supabase/supabase-js";

import { barsForRetention } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

import { evaluateMaCrossAtClose, type MaCrossBar } from "./ma-cross-eval";
import { parseSignalUserIdsFromEnv } from "./signal-user-ids";

export type SignalsCatalogCloseBody = {
  closeTimeIso: string;
  timeframe?: string;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  candleSyncRunId?: string | null;
};

export type RunSignalsCatalogCloseResult = {
  ok: true;
  marketsProcessed: number;
  signalsUpserted: number;
  nextMarketOffset: number | null;
  totalMarkets: number;
  skippedReason?: string;
};

function closeTimesMatch(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta - tb) < 2000;
  return a === b;
}

function signalMarketBatchSize(): number {
  const n = Number(process.env.SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

function signalMaxTotalMarkets(): number | null {
  const raw = process.env.SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

type CandleRow = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps: { close_time: string; open_time: string } | { close_time: string; open_time: string }[] | null;
};

function mapCandleRows(rows: CandleRow[]): { id: string; close: number; closeTimeIso: string }[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return {
        id: r.id,
        close: Number(r.close),
        closeTimeIso: closeTime,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function fetchCandlesForMarket(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; barLimit: number },
): Promise<CandleRow[]> {
  const { data, error } = await admin
    .schema("catalog")
    .from("candles")
    .select("id, open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .limit(args.barLimit);

  if (error) throw new Error(error.message);
  return (data ?? []) as CandleRow[];
}

export async function runSignalsCatalogClose(
  body: SignalsCatalogCloseBody,
  opts?: { allowQStashSelfQueue?: boolean },
): Promise<RunSignalsCatalogCloseResult> {
  const allowQStashSelfQueue = opts?.allowQStashSelfQueue !== false;
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? signalMarketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;

  const userIds = parseSignalUserIdsFromEnv();
  if (!userIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "no_signal_user_ids",
    };
  }

  const { data: ex, error: exErr } = await admin.schema("catalog").from("exchanges").select("id").eq("code", "bitvavo").single();
  if (exErr || !ex) throw new Error("Bitvavo exchange not found");
  const exchangeId = ex.id as string;

  let countQuery = admin
    .schema("catalog")
    .from("markets")
    .select("id", { count: "exact", head: true })
    .eq("exchange_id", exchangeId);
  if (quote != null && String(quote).trim() !== "") {
    countQuery = countQuery.eq("quote_code", String(quote).trim().toUpperCase());
  }
  const { count: totalMarkets, error: countErr } = await countQuery;
  if (countErr) throw new Error(countErr.message);
  const total = totalMarkets ?? 0;
  const maxTotal = signalMaxTotalMarkets();
  const effectiveTotal = maxTotal != null ? Math.min(total, maxTotal) : total;

  if (marketOffset >= effectiveTotal || effectiveTotal === 0) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: effectiveTotal,
      skippedReason: marketOffset >= effectiveTotal ? "market_offset_past_end" : undefined,
    };
  }

  const quoteArg = quote != null && String(quote).trim() !== "" ? String(quote).trim().toUpperCase() : null;
  const { data: markets, error: listErr } = await admin.schema("catalog").rpc("bitvavo_markets_for_candle_sync_slice", {
    p_exchange_id: exchangeId,
    p_quote: quoteArg,
    p_offset: marketOffset,
    p_limit: marketBatchSize,
  });
  if (listErr) throw new Error(listErr.message);
  const rowsRaw = (markets ?? []) as { id: string; market_symbol: string }[];
  const remainingBudget = Math.max(effectiveTotal - marketOffset, 0);
  const rows = remainingBudget < rowsRaw.length ? rowsRaw.slice(0, remainingBudget) : rowsRaw;

  if (rows.length === 0) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: effectiveTotal,
      skippedReason: "no_market_rows",
    };
  }

  const { data: agentRows, error: agentErr } = await admin
    .schema("trading")
    .from("signal_agents")
    .select("agent_id, enabled, config, allowed_timeframes")
    .eq("enabled", true);
  if (agentErr) throw new Error(agentErr.message);

  const agents = (agentRows ?? []) as {
    agent_id: string;
    enabled: boolean;
    config: unknown;
    allowed_timeframes: string[] | null;
  }[];

  const activeAgents = agents.filter((a) => {
    const tf = a.allowed_timeframes;
    if (!tf || tf.length === 0) return true;
    return tf.includes(timeframe);
  });

  const barLimit = barsForRetention(timeframe);
  let signalsUpserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const raw = await fetchCandlesForMarket(admin, { marketId, timeframe, barLimit });
    const sorted = mapCandleRows(raw);
    const barsAsc: MaCrossBar[] = sorted.map((r) => ({ close: r.close, closeTimeIso: r.closeTimeIso }));
    const targetRow = sorted.find((r) => closeTimesMatch(r.closeTimeIso, closeTimeIso));
    const candleId = targetRow?.id ?? null;
    const closeTimeForRow = targetRow?.closeTimeIso ?? closeTimeIso;

    for (const agent of activeAgents) {
      if (agent.agent_id !== "ma-cross-5m-v1") continue;

      const cfg = (agent.config ?? {}) as { fastPeriod?: number; slowPeriod?: number };
      const fastPeriod = Math.floor(Number(cfg.fastPeriod ?? 9));
      const slowPeriod = Math.floor(Number(cfg.slowPeriod ?? 21));

      const ev = evaluateMaCrossAtClose({
        barsAsc,
        targetCloseTimeIso: closeTimeIso,
        fastPeriod,
        slowPeriod,
      });

      for (const userId of userIds) {
        const row = {
          user_id: userId,
          agent_id: agent.agent_id,
          market_id: marketId,
          candle_id: candleId,
          timeframe,
          close_time: closeTimeForRow,
          intent: ev.intent,
          confidence: ev.confidence,
          reasons: ev.reasons,
          metadata: {
            ...ev.metadata,
            market_symbol: m.market_symbol,
            ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
          },
        };

        const { error: upErr } = await admin.schema("trading").from("signals").upsert(row, {
          onConflict: "user_id,agent_id,market_id,timeframe,close_time",
        });
        if (upErr) throw new Error(`${m.market_symbol}: signals upsert: ${upErr.message}`);
        signalsUpserted += 1;
      }
    }
  }

  const nextOffset = marketOffset + rows.length;
  const nextMarketOffset = nextOffset < effectiveTotal ? nextOffset : null;

  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (nextMarketOffset != null && allowQStashSelfQueue && base && token) {
    const client = new Client({ token });
    await client.publishJSON({
      url: `${base}/api/workers/signals-catalog-close`,
      body: {
        closeTimeIso,
        timeframe,
        quote,
        marketOffset: nextMarketOffset,
        marketBatchSize,
        candleSyncRunId: body.candleSyncRunId ?? undefined,
      },
      retries: 3,
    });
  }

  return {
    ok: true,
    marketsProcessed: rows.length,
    signalsUpserted,
    nextMarketOffset,
    totalMarkets: effectiveTotal,
  };
}

/**
 * When QStash is not configured, process remaining market batches in-process (dev / local).
 */
export async function runSignalsCatalogCloseDrain(body: SignalsCatalogCloseBody): Promise<RunSignalsCatalogCloseResult> {
  let offset = body.marketOffset ?? 0;
  let totalSignals = 0;
  let totalMarkets = 0;
  let last: RunSignalsCatalogCloseResult | null = null;
  const maxIters = Number(process.env.SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS ?? 400);
  const cap = Math.min(Math.max(Math.floor(maxIters), 1), 2000);

  let marketsSum = 0;
  for (let i = 0; i < cap; i++) {
    last = await runSignalsCatalogClose({ ...body, marketOffset: offset }, { allowQStashSelfQueue: false });
    totalMarkets = last.totalMarkets;
    totalSignals += last.signalsUpserted;
    marketsSum += last.marketsProcessed;
    if (last.nextMarketOffset == null) break;
    offset = last.nextMarketOffset;
  }

  return {
    ok: true,
    marketsProcessed: marketsSum,
    signalsUpserted: totalSignals,
    nextMarketOffset: last?.nextMarketOffset ?? null,
    totalMarkets,
  };
}
