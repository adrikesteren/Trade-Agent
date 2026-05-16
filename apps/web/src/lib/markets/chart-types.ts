/** Interval Bitvavo catalog sync writes to `candles`; chart API + Realtime filter must stay in sync. */
export const CATALOG_STORAGE_TIMEFRAME = "15m" as const;

/** Rows safe to pass from server → client (JSON-serializable). */
export type CandleRowJson = {
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const CHART_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

export function isChartTimeframe(s: string): s is ChartTimeframe {
  return (CHART_TIMEFRAMES as readonly string[]).includes(s);
}

/** Intents we render on the price chart as markers — HOLD is intentionally excluded. */
export const CHART_VISIBLE_INTENTS = ["ENTER", "ADD", "REDUCE", "EXIT"] as const;
export type ChartVisibleIntent = (typeof CHART_VISIBLE_INTENTS)[number];

export function isChartVisibleIntent(s: string): s is ChartVisibleIntent {
  return (CHART_VISIBLE_INTENTS as readonly string[]).includes(s);
}

/**
 * One signal point as rendered on the chart. `bucketOpenTimeIso` is the openTime ISO of
 * the **aggregated** bar for the active timeframe (so markers land on the right candle
 * after `aggregateOhlcvToTarget`).
 */
export type ChartSignal = {
  id: string;
  bucketOpenTimeIso: string;
  intent: ChartVisibleIntent;
  agentSlug: string;
  side: "long" | "short";
  confidence: number | null;
};

/** Output of the `regime-classifier-15m-v1` agent (`metadata.regime`). */
export const REGIME_LABELS = ["bull", "bear", "sideways"] as const;
export type RegimeLabel = (typeof REGIME_LABELS)[number];

export function isRegimeLabel(s: unknown): s is RegimeLabel {
  return typeof s === "string" && (REGIME_LABELS as readonly string[]).includes(s);
}

/** Slug of the `signal_agents.agent_id` row that produces regime classifications. */
export const REGIME_CLASSIFIER_AGENT_SLUG = "regime-classifier-15m-v1" as const;

/**
 * One regime *change* on the chart. Only emitted when `regime !== prevRegime` along the
 * chronological sequence of regime classifier signals for this market — so a long bull
 * stretch produces a single "BULL" marker at its start, not one per bar.
 */
export type ChartRegimeChange = {
  id: string;
  bucketOpenTimeIso: string;
  regime: RegimeLabel;
  /** Previous regime in the chronological series, or `null` for the very first entry. */
  prevRegime: RegimeLabel | null;
};
