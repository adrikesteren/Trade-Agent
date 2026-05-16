import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEnabledSignalAgents } from "@/lib/agents/signal/services/enabled-signal-agents-fetch.service";
import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import {
  loadSignalCoverage,
  missingAgentIdsForCandle,
} from "@/lib/agents/signal/services/signal-coverage.service";
import { upsertSignalsForMarketCloseFromBars } from "@/lib/agents/signal/services/market-close-signal-upsert.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  CATALOG_MARKET_CHART_CANDLE_MAX_ROWS,
  CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE,
} from "@/lib/markets/fetch-market-chart-candles";

/**
 * Soft wall-clock budget inside the worker (ms). We stop iterating before this
 * elapses so the caller sees a clean `deadlineHit: true` summary instead of
 * having Relay kill the request mid-upsert. Pair with the Relay-side
 * `RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S` (10 min); 9 min budget leaves
 * headroom for the final per-bar upsert and HTTP teardown.
 */
export const MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS = 9 * 60 * 1000;

export type RunMarketEvaluateAllSignalsArgs = {
  marketId: string;
  /** Override the wall-clock budget (ms). Defaults to {@link MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS}. */
  budgetMs?: number;
  signalsSyncRunId?: string | null;
  /**
   * Slugs of agents whose existing signals should be **overwritten** instead of skipped.
   * Use this when an agent's seed config changes (e.g. regime classifier moved from daily ×
   * SMA(200) to 4h × SMA(200)) and stale rows need to be regenerated. The upsert key is
   * `(signal_agent_id, candle_id, user_id)` so the row id is preserved → downstream FK
   * references (`trading.decisions.signal_id`, etc.) survive.
   */
  forceAgentSlugs?: readonly string[];
  /**
   * Optional inclusive lower bound on the bar `closeTime` to *process*. Bars before this
   * are still loaded (warmup is needed by indicator-based agents) but not evaluated. Used
   * by the chunked Relay publisher to fan a long history out across multiple messages.
   */
  closeTimeGteIso?: string | null;
  /**
   * Optional inclusive upper bound on the bar `closeTime` to *process*. Bars after this
   * are still loaded (so a future chunk knows about them) but not evaluated. Used by the
   * chunked Relay publisher to fan a long history out across multiple messages.
   */
  closeTimeLteIso?: string | null;
};

export type RunMarketEvaluateAllSignalsResult = {
  ok: true;
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  /** Total stored bars for the market (denominator for "X of Y"). */
  candleTotal: number;
  /** Bars where at least one missing agent was evaluated. */
  barsProcessed: number;
  /** Total `trading.signals` rows upserted across all processed bars. */
  signalsUpserted: number;
  /** True when the loop stopped because the wall-clock budget was reached. */
  deadlineHit: boolean;
  /** Number of enabled `signal_agents` rows considered (after timeframe filter). */
  agentCount: number;
};

type StoredBar = {
  id: string;
  closeTimeIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type RawCandleRow = {
  id: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  candle_timestamps: unknown;
};

function unwrapTs(raw: unknown): { close_time?: string | null } | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return (raw[0] as { close_time?: string | null }) ?? null;
  return raw as { close_time?: string | null };
}

/**
 * Pull every storage-timeframe candle for a market (paginated past PostgREST
 * `max_rows`), ascending by `close_time`. Returns the rows the orchestrator
 * needs as `SortedBar[]` (id + OHLCV + closeTimeIso).
 */
async function fetchAllStoredBarsAsc(
  admin: SupabaseClient,
  marketId: string,
): Promise<StoredBar[]> {
  const out: StoredBar[] = [];
  let from = 0;

  while (out.length < CATALOG_MARKET_CHART_CANDLE_MAX_ROWS) {
    const room = CATALOG_MARKET_CHART_CANDLE_MAX_ROWS - out.length;
    const page = Math.min(CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE, room);
    const to = from + page - 1;

    const { data, error } = await admin
      .schema("catalog")
      .from("candles")
      .select("id, open, high, low, close, volume, candle_timestamps ( close_time )")
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
      .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
      .range(from, to);

    if (error) throw new Error(error.message);

    const chunk = (data ?? []) as RawCandleRow[];
    if (!chunk.length) break;

    for (const row of chunk) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const ts = unwrapTs(row.candle_timestamps);
      const closeTimeIso = ts?.close_time?.trim();
      if (!closeTimeIso) continue;
      out.push({
        id,
        closeTimeIso,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      });
    }

    from += chunk.length;
    if (chunk.length < page) break;
  }

  return out;
}

/**
 * Re-evaluate every stored 15m candle for a market, but **skip** any
 * `(agent, candle)` tuple that already has a `trading.signals` row for the
 * automation user. Stops cleanly when {@link MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS}
 * is reached so Relay never kills the run mid-upsert.
 *
 * No Bitvavo ingest, no mediator/executor — signals only.
 */
export async function runMarketEvaluateAllSignals(
  admin: SupabaseClient,
  args: RunMarketEvaluateAllSignalsArgs,
): Promise<RunMarketEvaluateAllSignalsResult> {
  const marketId = args.marketId.trim();
  if (!marketId) {
    throw new Error("marketId is required.");
  }
  const budgetMs = Math.max(10_000, args.budgetMs ?? MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS);

  const { data: mrow, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("id", marketId)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("Market not found.");
  const marketSymbol = String((mrow as { market_symbol?: string | null }).market_symbol ?? "");

  const timeframe = CATALOG_STORAGE_TIMEFRAME;

  const sortedAll = await fetchAllStoredBarsAsc(admin, marketId);
  const candleTotal = sortedAll.length;

  if (candleTotal === 0) {
    return {
      ok: true,
      marketId,
      marketSymbol,
      timeframe,
      candleTotal: 0,
      barsProcessed: 0,
      signalsUpserted: 0,
      deadlineHit: false,
      agentCount: 0,
    };
  }

  const signalUserIds = await getCatalogPipelineUserIds(admin);
  if (signalUserIds.length === 0) {
    throw new Error(
      "Evaluate-all-signals requires the automated_process user (automation_actor or user_profiles.username = automated_process).",
    );
  }

  const enabledAgents = await fetchEnabledSignalAgents(admin, { timeframe });
  const enabledAgentIds = new Set(enabledAgents.map((a) => a.id));
  const agentCount = enabledAgentIds.size;

  // Resolve the optional `forceAgentSlugs` set to UUIDs in the enabled set. Slugs that don't
  // resolve to an enabled agent are silently ignored (no point forcing an agent we can't
  // dispatch anyway).
  const forceSlugSet = new Set((args.forceAgentSlugs ?? []).map((s) => s.trim()).filter(Boolean));
  const forceAgentIds: ReadonlySet<string> = new Set(
    enabledAgents.filter((a) => forceSlugSet.has(a.slug)).map((a) => a.id),
  );

  if (agentCount === 0) {
    return {
      ok: true,
      marketId,
      marketSymbol,
      timeframe,
      candleTotal,
      barsProcessed: 0,
      signalsUpserted: 0,
      deadlineHit: false,
      agentCount: 0,
    };
  }

  const allCandleIds = sortedAll.map((b) => b.id);
  const coverage = await loadSignalCoverage(admin, allCandleIds, signalUserIds);

  // Optional close-time slice — used by the chunked Relay publisher to split one
  // market into N sub-windows. Bars outside the window are still kept in `sortedAll`
  // so indicator-based agents have proper warmup, but they are not processed.
  const sliceGteMs = (() => {
    const v = args.closeTimeGteIso ? Date.parse(args.closeTimeGteIso) : NaN;
    return Number.isFinite(v) ? v : null;
  })();
  const sliceLteMs = (() => {
    const v = args.closeTimeLteIso ? Date.parse(args.closeTimeLteIso) : NaN;
    return Number.isFinite(v) ? v : null;
  })();

  const startedMs = Date.now();
  let barsProcessed = 0;
  let signalsUpserted = 0;
  let deadlineHit = false;

  for (let i = 0; i < sortedAll.length; i += 1) {
    if (Date.now() - startedMs > budgetMs) {
      deadlineHit = true;
      break;
    }

    const bar = sortedAll[i]!;
    if (sliceGteMs != null || sliceLteMs != null) {
      const barMs = Date.parse(bar.closeTimeIso);
      if (Number.isFinite(barMs)) {
        if (sliceGteMs != null && barMs < sliceGteMs) continue;
        if (sliceLteMs != null && barMs > sliceLteMs) continue;
      }
    }
    const missingAgentIds = missingAgentIdsForCandle(
      enabledAgentIds,
      coverage,
      bar.id,
      forceAgentIds,
    );
    if (missingAgentIds.size === 0) continue;

    const barsThrough = sortedAll.slice(0, i + 1);

    const upserted = await upsertSignalsForMarketCloseFromBars(admin, {
      marketId,
      marketSymbol,
      timeframe,
      closeTimeIso: bar.closeTimeIso,
      sortedBarsAsc: barsThrough,
      signalUserIds,
      signalsSyncRunId: args.signalsSyncRunId ?? null,
      onlyAgentIds: missingAgentIds,
    });
    barsProcessed += 1;
    signalsUpserted += upserted;
  }

  return {
    ok: true,
    marketId,
    marketSymbol,
    timeframe,
    candleTotal,
    barsProcessed,
    signalsUpserted,
    deadlineHit,
    agentCount,
  };
}
