import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllCandleTimestampIdsInCloseTimeRange } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";
import * as CandlesSelector from "@/lib/selectors/candles-selector";

import { computeHistoricalCandleWindow } from "./historical-candle-window.service";

/** Default number of closed bars before the replay window so MA/ATR/RSI have enough indicator history. */
export const HISTORICAL_REPLAY_WARMUP_BARS = 120;

/** PostgREST `.in()` batch size for `candle_timestamp_id` (URI length). */
const CANDLE_TS_IN_CHUNK = 80;

export type ReplayCandleBar = {
  id: string;
  high: number;
  low: number;
  close: number;
  closeTimeIso: string;
};

type CandleRowDb = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps:
    | { close_time: string; open_time: string }
    | { close_time: string; open_time: string }[]
    | null;
};

function mapCandleRows(rows: CandleRowDb[]): ReplayCandleBar[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return {
        id: r.id,
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        closeTimeIso: closeTime,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function loadCandlesThroughRange(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<ReplayCandleBar[]> {
  const tsIds = await fetchAllCandleTimestampIdsInCloseTimeRange(admin, {
    closeTimeGteIso: args.closeTimeGteIso,
    closeTimeLteIso: args.closeTimeLteIso,
  });
  const out: CandleRowDb[] = [];
  for (let i = 0; i < tsIds.length; i += CANDLE_TS_IN_CHUNK) {
    const part = tsIds.slice(i, i + CANDLE_TS_IN_CHUNK);
    const cRows = await CandlesSelector.selectOhlcvWithOpenCloseByCandleTimestampIds(admin, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      candleTimestampIds: part,
    });
    out.push(...(cRows as CandleRowDb[]));
  }
  return mapCandleRows(out);
}

/** Count `catalog.candles` rows for a market/timeframe whose bucket `close_time` lies in the range. */
async function countCandlesForMarketByCloseTimeRange(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<number> {
  const tsIds = await fetchAllCandleTimestampIdsInCloseTimeRange(admin, {
    closeTimeGteIso: args.closeTimeGteIso,
    closeTimeLteIso: args.closeTimeLteIso,
  });
  let total = 0;
  for (let i = 0; i < tsIds.length; i += CANDLE_TS_IN_CHUNK) {
    const part = tsIds.slice(i, i + CANDLE_TS_IN_CHUNK);
    total += await CandlesSelector.countByMarketTimeframeAndCandleTimestampIds(admin, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      candleTimestampIds: part,
    });
  }
  return total;
}

export type LoadHistoricalCandlesForReplayResult = {
  /** Resolved window from `computeHistoricalCandleWindow` (kind: "ok"). */
  win: { startOpenMs: number; endCloseMs: number; barCount: number };
  /** All bars from `warmupCloseFloor` through `endClose`, ascending — sufficient for the Signal Agent. */
  sortedAll: ReplayCandleBar[];
  /** Subset of `sortedAll` whose close falls inside the inclusive replay window. */
  replayCloses: ReplayCandleBar[];
  /** First close time in the replay window (the bar that closes at `startOpenMs + step`). */
  firstReplayCloseIso: string;
  /** Last close time in the replay window (`endCloseMs`). */
  lastReplayCloseIso: string;
};

/**
 * Loads warmup + replay-window candles for a single market/timeframe and returns ascending bars.
 *
 * Fails when the catalog ingest is severely incomplete (≥ max(50, 2% of barCount) missing rows in the
 * replay window) so callers don’t silently signal on a hole-ridden series.
 */
export async function loadHistoricalCandlesForReplay(
  admin: SupabaseClient,
  args: {
    marketId: string;
    timeframe: string;
    historicalStartDate: string;
    historicalEndDate: string;
    /** Defaults to {@link HISTORICAL_REPLAY_WARMUP_BARS}. */
    warmupBars?: number;
  },
): Promise<LoadHistoricalCandlesForReplayResult> {
  const warmupBars = args.warmupBars ?? HISTORICAL_REPLAY_WARMUP_BARS;
  const stepMs = timeframeDurationMs(args.timeframe);

  const win = computeHistoricalCandleWindow({
    startDate: args.historicalStartDate,
    endDate: args.historicalEndDate,
    timeframe: args.timeframe,
  });
  if (win.kind !== "ok") {
    throw new Error(`Invalid historical window: ${win.reason}`);
  }

  const firstReplayCloseMs = win.startOpenMs + stepMs;
  const warmupCloseFloorMs = firstReplayCloseMs - warmupBars * stepMs;
  const warmupCloseFloorIso = new Date(warmupCloseFloorMs).toISOString();
  const firstReplayCloseIso = new Date(firstReplayCloseMs).toISOString();
  const lastReplayCloseIso = new Date(win.endCloseMs).toISOString();

  const candleCountInReplayWindow = await countCandlesForMarketByCloseTimeRange(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    closeTimeGteIso: firstReplayCloseIso,
    closeTimeLteIso: lastReplayCloseIso,
  });
  const missingBars = win.barCount - candleCountInReplayWindow;
  const largeIngestShortfall = missingBars >= Math.max(50, Math.ceil(win.barCount * 0.02));
  if (largeIngestShortfall) {
    throw new Error(
      `Historical candle ingest is severely incomplete: expected ${win.barCount} closed bars between ${args.historicalStartDate} and ${args.historicalEndDate} ` +
        `but only ${candleCountInReplayWindow} rows exist in catalog.candles for that close range (missing ${missingBars}). ` +
        `Bitvavo omits intervals with no trades (see https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/). ` +
        `If the market should be liquid across the whole range, retry after verifying Bitvavo window sync and timestamp grid alignment.`,
    );
  }

  const sortedAll = await loadCandlesThroughRange(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    closeTimeGteIso: warmupCloseFloorIso,
    closeTimeLteIso: lastReplayCloseIso,
  });

  const replayCloses = sortedAll.filter(
    (b) => Date.parse(b.closeTimeIso) >= firstReplayCloseMs && Date.parse(b.closeTimeIso) <= win.endCloseMs,
  );
  if (replayCloses.length === 0) {
    throw new Error("No candles in database for the historical range after ingest.");
  }

  return {
    win: { startOpenMs: win.startOpenMs, endCloseMs: win.endCloseMs, barCount: win.barCount },
    sortedAll,
    replayCloses,
    firstReplayCloseIso,
    lastReplayCloseIso,
  };
}
