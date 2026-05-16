"use client";

import { dateOrderLocale, formatDatetime, formatDecimal } from "@/lib/locale/format";
import type { UserDateFormat, UserDecimalFormat, UserLocalePreferences, UserTimeFormat, UserTimezone } from "@/lib/locale/types";
import type {
  CandleRowJson,
  ChartRegimeChange,
  ChartSignal,
  ChartTimeframe,
} from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME, CHART_TIMEFRAMES } from "@/lib/markets/chart-types";
import { candleTimeToUnixSeconds } from "@/lib/agents/ingest/services/candle-time.service";
import { createClient } from "@/lib/supabase/client";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPanePrimitive,
  type IPanePrimitivePaneView,
  type IPrimitivePaneRenderer,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type PaneAttachedParameter,
  type PrimitivePaneViewZOrder,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Button, Card, CardBody } from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatChartCrosshairTime(t: Time, timeZone: string, tickLocale: string, hour12: boolean): string {
  if (typeof t !== "number" || !Number.isFinite(t)) return String(t);
  try {
    return new Intl.DateTimeFormat(tickLocale, {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12,
      timeZoneName: "short",
    }).format(new Date(t * 1000));
  } catch {
    return new Date(t * 1000).toISOString();
  }
}

/**
 * v5: `localization.timeFormatter` only affects the crosshair label, not time-axis ticks.
 * Tick marks use the same display timezone (≤8 chars where possible).
 */
function formatChartTickMark(
  time: Time,
  tickMarkType: TickMarkType,
  tickLocale: string,
  timeZone: string,
  hour12: boolean,
): string | null {
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  const d = new Date(time * 1000);
  const loc = tickLocale || undefined;
  const max = (s: string) => (s.length > 8 ? s.slice(0, 8) : s);
  try {
    switch (tickMarkType) {
      case TickMarkType.Year:
        return max(new Intl.DateTimeFormat(loc, { timeZone, year: "numeric" }).format(d));
      case TickMarkType.Month:
        return max(new Intl.DateTimeFormat(loc, { timeZone, month: "2-digit", year: "2-digit" }).format(d));
      case TickMarkType.DayOfMonth:
        return max(new Intl.DateTimeFormat(loc, { timeZone, month: "2-digit", day: "2-digit" }).format(d));
      case TickMarkType.Time:
        return max(new Intl.DateTimeFormat(loc, { timeZone, hour: "2-digit", minute: "2-digit", hour12 }).format(d));
      case TickMarkType.TimeWithSeconds:
        return max(
          new Intl.DateTimeFormat(loc, {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12,
          }).format(d),
        );
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function toCandlestick(row: CandleRowJson): CandlestickData<UTCTimestamp> {
  const t = candleTimeToUnixSeconds(row.openTime) as UTCTimestamp;
  return {
    time: t,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  };
}

function toVolume(row: CandleRowJson, prevClose: number): HistogramData<UTCTimestamp> {
  const t = candleTimeToUnixSeconds(row.openTime) as UTCTimestamp;
  const up = row.close >= prevClose;
  return {
    time: t,
    value: row.volume,
    color: up ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)",
  };
}

/** Tooltip placement next to crosshair (chart-local px), CoinGecko-style: prefer right of cursor, flip if needed. */
function hoverTooltipLayout(
  chartWidth: number,
  chartHeight: number,
  point: { readonly x: number; readonly y: number },
): { left: number; top: number; transform: string } {
  const gap = 20;
  const estW = 272;
  const estH = 148;
  const pad = 6;
  const ax = point.x;
  const ay = point.y;

  const roomRight = chartWidth - ax - gap - pad;
  const placeLeft = roomRight < estW * 0.85;

  let left: number;
  let transform: string;
  if (placeLeft) {
    // `left` is the right edge of the box before translate(-100%, …)
    left = Math.max(estW + pad, Math.min(ax - gap, chartWidth - pad));
    transform = "translate(-100%, -50%)";
  } else {
    left = Math.max(pad, Math.min(ax + gap, chartWidth - estW - pad));
    transform = "translateY(-50%)";
  }

  const top = Math.max(estH / 2 + pad, Math.min(ay, chartHeight - estH / 2 - pad));

  return { left, top, transform };
}

function computeChange(rows: CandleRowJson[]): number | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort(
    (a, b) => candleTimeToUnixSeconds(a.openTime) - candleTimeToUnixSeconds(b.openTime),
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (!first.open) return null;
  return ((last.close - first.open) / first.open) * 100;
}

/** ENTER/ADD = entry side (green up arrow below bar); EXIT/REDUCE = close side (red down arrow above bar). */
function isEntryIntent(intent: ChartSignal["intent"]): boolean {
  return intent === "ENTER" || intent === "ADD";
}

const MARKER_ENTRY_COLOR = "#16a34a";
const MARKER_EXIT_COLOR = "#dc2626";

const REGIME_BULL_COLOR = "#16a34a";
const REGIME_BEAR_COLOR = "#dc2626";
const REGIME_SIDEWAYS_COLOR = "#d97706";
/** Subtle band fill — visible enough to read the regime at a glance, light enough to keep candles legible. */
const REGIME_BAND_FILL_LIGHT: Record<ChartRegimeChange["regime"], string> = {
  bull: "rgba(22, 163, 74, 0.12)",
  bear: "rgba(220, 38, 38, 0.12)",
  sideways: "rgba(217, 119, 6, 0.12)",
};
const REGIME_BAND_FILL_DARK: Record<ChartRegimeChange["regime"], string> = {
  bull: "rgba(22, 163, 74, 0.18)",
  bear: "rgba(220, 38, 38, 0.18)",
  sideways: "rgba(217, 119, 6, 0.22)",
};

/**
 * Render a `ChartSignal.confidence` (0..1, often null for non-directional signals like
 * sideways regime) as a 2-digit percentage suffix. Returns the empty string when there's
 * nothing useful to display so the caller can keep the marker text compact.
 */
function formatConfidenceSuffix(confidence: number | null): string {
  if (confidence == null || !Number.isFinite(confidence)) return "";
  const pct = Math.round(confidence * 100);
  if (pct < 1) return "";
  return ` ${pct}%`;
}

function buildSignalMarkers(
  signals: ChartSignal[],
  enabledAgents: Set<string>,
  showConfidence: boolean,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const s of signals) {
    if (!enabledAgents.has(s.agentSlug)) continue;
    const sec = candleTimeToUnixSeconds(s.bucketOpenTimeIso);
    if (!Number.isFinite(sec)) continue;
    const entry = isEntryIntent(s.intent);
    const confSuffix = showConfidence ? formatConfidenceSuffix(s.confidence) : "";
    markers.push({
      id: s.id,
      time: sec as UTCTimestamp,
      position: entry ? "belowBar" : "aboveBar",
      shape: entry ? "arrowUp" : "arrowDown",
      color: entry ? MARKER_ENTRY_COLOR : MARKER_EXIT_COLOR,
      text: `${s.intent}${confSuffix}`,
    });
  }
  // Lightweight Charts v5 requires markers ordered ascending by time.
  markers.sort((a, b) => Number(a.time) - Number(b.time));
  return markers;
}

type RegimeBand = {
  regime: ChartRegimeChange["regime"];
  /** Bar open-time of the bar where the new regime started (unix seconds). */
  startTime: UTCTimestamp;
  /** Bar open-time of the bar where the next regime took over (unix seconds). */
  endTime: UTCTimestamp;
};

/**
 * Convert the chronological list of regime *switches* into contiguous time-bands. Each band runs
 * from its switch bar's open-time to the next switch's open-time; the trailing band is closed
 * at `lastBarTimeSec` so it always has a finite end. Returns `[]` when there's nothing to draw.
 */
function buildRegimeBands(
  regimeChanges: ChartRegimeChange[],
  lastBarTimeSec: number | null,
): RegimeBand[] {
  if (regimeChanges.length === 0 || lastBarTimeSec == null || !Number.isFinite(lastBarTimeSec)) {
    return [];
  }

  const sorted = [...regimeChanges].sort(
    (a, b) => Date.parse(a.bucketOpenTimeIso) - Date.parse(b.bucketOpenTimeIso),
  );

  const bands: RegimeBand[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const startSec = candleTimeToUnixSeconds(cur.bucketOpenTimeIso);
    if (!Number.isFinite(startSec)) continue;

    const next = sorted[i + 1];
    let endSec: number;
    if (next) {
      const nextSec = candleTimeToUnixSeconds(next.bucketOpenTimeIso);
      endSec = Number.isFinite(nextSec) ? nextSec : lastBarTimeSec;
    } else {
      endSec = lastBarTimeSec;
    }
    if (endSec <= startSec) continue;

    bands.push({
      regime: cur.regime,
      startTime: startSec as UTCTimestamp,
      endTime: endSec as UTCTimestamp,
    });
  }
  return bands;
}

/**
 * Lightweight Charts v5 pane primitive that paints translucent vertical bands behind the
 * candles for each contiguous regime period. Uses `zOrder: "bottom"` so candles, volume,
 * and signal markers stay on top.
 */
class RegimeBandsPrimitive implements IPanePrimitive<Time> {
  private _bands: RegimeBand[] = [];
  private _palette: Record<ChartRegimeChange["regime"], string> = REGIME_BAND_FILL_LIGHT;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private readonly _paneView: RegimeBandsPaneView;

  constructor() {
    this._paneView = new RegimeBandsPaneView(
      () => this._chart,
      () => this._bands,
      () => this._palette,
    );
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._requestUpdate = null;
  }

  setBands(bands: RegimeBand[]): void {
    this._bands = bands;
    this._requestUpdate?.();
  }

  setPalette(palette: Record<ChartRegimeChange["regime"], string>): void {
    this._palette = palette;
    this._requestUpdate?.();
  }

  updateAllViews(): void {
    /* views read live via closures — nothing to mutate */
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return [this._paneView];
  }
}

class RegimeBandsPaneView implements IPanePrimitivePaneView {
  constructor(
    private readonly getChart: () => IChartApi | null,
    private readonly getBands: () => RegimeBand[],
    private readonly getPalette: () => Record<ChartRegimeChange["regime"], string>,
  ) {}

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const chart = this.getChart();
    if (!chart) return null;
    return new RegimeBandsRenderer(chart, this.getBands(), this.getPalette());
  }
}

type CanvasScope = {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
};

type CanvasRenderingTargetLike = {
  useBitmapCoordinateSpace: (cb: (scope: CanvasScope) => void) => void;
};

class RegimeBandsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly chart: IChartApi,
    private readonly bands: RegimeBand[],
    private readonly palette: Record<ChartRegimeChange["regime"], string>,
  ) {}

  draw(target: CanvasRenderingTargetLike): void {
    if (this.bands.length === 0) return;
    const ts = this.chart.timeScale();
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const heightPx = scope.bitmapSize.height;
      const widthPx = scope.bitmapSize.width;
      const hpr = scope.horizontalPixelRatio;
      const widthCss = widthPx / hpr;

      for (const band of this.bands) {
        const x1 = ts.timeToCoordinate(band.startTime);
        const x2 = ts.timeToCoordinate(band.endTime);
        // Either edge can fall outside the data range; clip to the visible chart width
        // so bands that extend past the visible window still paint up to the edge.
        const leftCss = x1 == null ? 0 : Math.max(0, x1);
        const rightCss = x2 == null ? widthCss : Math.min(widthCss, x2);
        if (rightCss <= leftCss) continue;

        const left = leftCss * hpr;
        const width = (rightCss - leftCss) * hpr;
        ctx.fillStyle = this.palette[band.regime];
        ctx.fillRect(left, 0, width, heightPx);
      }
    });
  }
}

/**
 * Open-time of the last (newest) candle in unix seconds, or `null` when the array is empty
 * or the time can't be parsed. Used as the right-edge fallback for the trailing regime band
 * so it always closes at the most recent bar instead of bleeding past the data.
 */
function lastBarUnixSec(rows: CandleRowJson[]): number | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  const sec = candleTimeToUnixSeconds(last.openTime);
  return Number.isFinite(sec) ? sec : null;
}

function uniqueAgentSlugs(signals: ChartSignal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of signals) {
    if (seen.has(s.agentSlug)) continue;
    seen.add(s.agentSlug);
    out.push(s.agentSlug);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function useIsDarkClass(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => {
      if (!root.classList.contains("dark") && !root.classList.contains("light")) {
        setDark(mq.matches);
      } else {
        sync();
      }
    };
    mq.addEventListener("change", onMq);
    onMq();
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);
  return dark;
}

/**
 * Coverage hint surfaced when `regime-classifier-15m-v1` was running but didn't yet have
 * enough trend-timeframe bars (current seed: SMA(100) on 1h ⇒ ~100 bars) to make a real
 * bull/bear/sideways call. The default fallback row writes `regime: "sideways"`, which we
 * filter out of the band rendering — but we still want to tell the user *why* the regime
 * row is empty, in the right unit (1h / 4h / daily / 15m).
 */
export type RegimeInsufficientHistoryHint = {
  haveBars: number;
  needBars: number;
  asOfOpenTimeIso: string;
  /** Trend timeframe (minutes) the SMA was computed on. Null for legacy rows pre-config-aware. */
  trendTimeframeMinutes: number | null;
};

/** Format `trendTimeframeMinutes` as a short label suitable for "X / Y {label} bars". */
function formatTrendTimeframeLabel(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes === 1440) return "daily";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Pretty hint title — "~4 days" / "~33 days" / "~6 months" depending on memory length. */
function formatTrendMemoryHint(needBars: number, minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0 || needBars <= 0) return "";
  const totalMinutes = needBars * minutes;
  const days = totalMinutes / (60 * 24);
  if (days >= 60) return `~${Math.round(days / 30)} months`;
  if (days >= 1.5) return `~${Math.round(days)} days`;
  if (days >= 0.5) return `~${Math.round(totalMinutes / 60)} hours`;
  return `~${Math.round(totalMinutes)} minutes`;
}

type Props = {
  marketId: string;
  initialTimeframe: ChartTimeframe;
  initialCandles: CandleRowJson[];
  initialChartSignals: ChartSignal[];
  initialRegimeChanges: ChartRegimeChange[];
  initialRegimeInsufficient: RegimeInsufficientHistoryHint | null;
  /** Resolved IANA for axis + crosshair (`NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE` wins when set). */
  chartDisplayIana: string;
  userTimezone: UserTimezone;
  decimalFormat: UserDecimalFormat;
  dateFormat: UserDateFormat;
  timeFormat: UserTimeFormat;
};

type HoverOhlcv = {
  timeLabel: string;
  /** Bar `close_time` from DB, formatted like the chart (display timezone). */
  closeTimeLabel: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  left: number;
  top: number;
  transform: string;
};

/**
 * Polling cadence for live chart refreshes. Realtime is best-effort (only fires on
 * `catalog.candles` changes — new signals don't push), so a 15s timer guarantees the
 * chart catches up. Pauses while the document is hidden; flushes immediately on re-show.
 */
const CHART_LIVE_POLL_INTERVAL_MS = 15_000;

/**
 * Tiny "Live · 12s ago" badge in the chart toolbar. Pulses green while polling is
 * active; turns muted when the document is hidden (no network traffic). The relative
 * time is recomputed every second from a local tick state — cheap because it only
 * re-renders the badge, not the chart.
 */
function LiveBadge({
  lastRefreshMs,
  pollIntervalMs,
}: {
  lastRefreshMs: number | null;
  pollIntervalMs: number;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const id = setInterval(tick, 1_000);
    const onVis = () => {
      setHidden(document.hidden);
      tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, []);

  let label: string;
  let title: string;
  if (lastRefreshMs == null) {
    label = "Live";
    title = `Live polling every ${Math.round(pollIntervalMs / 1000)}s — waiting for first refresh.`;
  } else {
    const diffSec = Math.max(0, Math.round((nowMs - lastRefreshMs) / 1000));
    if (diffSec < 5) label = "now";
    else if (diffSec < 60) label = `${diffSec}s ago`;
    else if (diffSec < 3600) label = `${Math.floor(diffSec / 60)}m ago`;
    else label = `${Math.floor(diffSec / 3600)}h ago`;
    title = `Last refreshed ${new Date(lastRefreshMs).toLocaleString()}`;
  }

  const dotClass = hidden
    ? "h-2 w-2 rounded-full bg-zinc-400"
    : "h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      title={title}
      aria-label={title}
    >
      <span aria-hidden="true" className={dotClass} />
      <span>Live</span>
      {lastRefreshMs != null ? <span className="bk-text-muted">· {label}</span> : null}
    </span>
  );
}

export function MarketCandleChart({
  marketId,
  initialTimeframe,
  initialCandles,
  initialChartSignals,
  initialRegimeChanges,
  initialRegimeInsufficient,
  chartDisplayIana,
  userTimezone,
  decimalFormat,
  dateFormat,
  timeFormat,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const volSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const regimeBandsPrimitiveRef = useRef<RegimeBandsPrimitive | null>(null);

  const isDark = useIsDarkClass();

  const localePrefs: UserLocalePreferences = useMemo(
    () => ({
      timezone: userTimezone,
      decimal_format: decimalFormat,
      date_format: dateFormat,
      time_format: timeFormat,
      primary_asset: null,
    }),
    [userTimezone, decimalFormat, dateFormat, timeFormat],
  );

  const tickLocale = useMemo(() => dateOrderLocale(dateFormat), [dateFormat]);
  const hour12 = timeFormat === "h12";
  const tzOpts = useMemo(() => ({ timeZoneOverride: chartDisplayIana }), [chartDisplayIana]);

  const formatPrice = useCallback(
    (n: number) => formatDecimal(n, localePrefs, { maximumFractionDigits: 8 }),
    [localePrefs],
  );

  const formatVolume = useCallback(
    (n: number) => formatDecimal(n, localePrefs, { maximumFractionDigits: 4 }),
    [localePrefs],
  );

  const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
  const [candles, setCandles] = useState<CandleRowJson[]>(initialCandles);
  const [chartSignals, setChartSignals] = useState<ChartSignal[]>(initialChartSignals);
  const [regimeChanges, setRegimeChanges] = useState<ChartRegimeChange[]>(initialRegimeChanges);
  const [regimeInsufficient, setRegimeInsufficient] = useState<RegimeInsufficientHistoryHint | null>(
    initialRegimeInsufficient,
  );
  const [enabledAgents, setEnabledAgents] = useState<Set<string>>(
    () => new Set(uniqueAgentSlugs(initialChartSignals)),
  );
  const [showRegime, setShowRegime] = useState(true);
  const [showSignalConfidence, setShowSignalConfidence] = useState(true);
  const [changePct, setChangePct] = useState<number | null>(() => computeChange(initialCandles));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverOhlcv, setHoverOhlcv] = useState<HoverOhlcv | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showCandleInfo, setShowCandleInfo] = useState(true);

  const timeframeRef = useRef(timeframe);
  const candlesRef = useRef(candles);
  const chartSignalsRef = useRef(chartSignals);
  const regimeChangesRef = useRef(regimeChanges);
  const enabledAgentsRef = useRef(enabledAgents);
  const showRegimeRef = useRef(showRegime);
  const showSignalConfidenceRef = useRef(showSignalConfidence);
  const knownAgentsRef = useRef<Set<string>>(new Set(uniqueAgentSlugs(initialChartSignals)));

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    chartSignalsRef.current = chartSignals;
  }, [chartSignals]);

  useEffect(() => {
    regimeChangesRef.current = regimeChanges;
  }, [regimeChanges]);

  useEffect(() => {
    enabledAgentsRef.current = enabledAgents;
  }, [enabledAgents]);

  useEffect(() => {
    showRegimeRef.current = showRegime;
  }, [showRegime]);

  useEffect(() => {
    showSignalConfidenceRef.current = showSignalConfidence;
  }, [showSignalConfidence]);

  /** Keep `enabledAgents` in sync when refetched signals introduce new agents (default: enabled). */
  useEffect(() => {
    const fresh = uniqueAgentSlugs(chartSignals);
    let added = false;
    setEnabledAgents((prev) => {
      const next = new Set(prev);
      for (const slug of fresh) {
        if (!knownAgentsRef.current.has(slug)) {
          knownAgentsRef.current.add(slug);
          next.add(slug);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [chartSignals]);

  const agentSlugs = useMemo(() => uniqueAgentSlugs(chartSignals), [chartSignals]);

  const toggleAgent = useCallback((slug: string) => {
    setEnabledAgents((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const allAgentsEnabled = agentSlugs.length > 0 && agentSlugs.every((s) => enabledAgents.has(s));
  const setAllAgents = useCallback(
    (on: boolean) => {
      setEnabledAgents(on ? new Set(agentSlugs) : new Set());
    },
    [agentSlugs],
  );

  /**
   * `setData` on Lightweight Charts preserves the current visible time range — only
   * `fitContent()` resets it. We only want to refit on initial mount or when the user
   * explicitly switches timeframe; live polling refreshes must keep the user's zoom +
   * scroll position intact. The `fitOnNextPushRef` flag is set to `true` by the init
   * effect and `loadTf`, and cleared by `pushSeriesData` after each fit.
   */
  const fitOnNextPushRef = useRef(true);

  const pushSeriesData = useCallback((rows: CandleRowJson[]) => {
    const cs = candleSeriesRef.current;
    const vs = volSeriesRef.current;
    if (!cs || !vs) return;

    const sane = rows.filter((r) => Number.isFinite(candleTimeToUnixSeconds(r.openTime)));
    const sorted = [...sane].sort(
      (a, b) => candleTimeToUnixSeconds(a.openTime) - candleTimeToUnixSeconds(b.openTime),
    );
    const candleData = sorted.map(toCandlestick);
    (cs as { setData: (d: CandlestickData<UTCTimestamp>[]) => void }).setData(candleData);

    const volData: HistogramData<UTCTimestamp>[] = [];
    let prev = sorted[0]?.open ?? 0;
    for (const row of sorted) {
      volData.push(toVolume(row, prev));
      prev = row.close;
    }
    (vs as { setData: (d: HistogramData<UTCTimestamp>[]) => void }).setData(volData);

    if (fitOnNextPushRef.current) {
      chartRef.current?.timeScale().fitContent();
      fitOnNextPushRef.current = false;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const displayTz = chartDisplayIana;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 420,
      localization: {
        timeFormatter: (t: Time) => formatChartCrosshairTime(t, displayTz, tickLocale, hour12),
      },
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#09090b" : "#ffffff" },
        textColor: isDark ? "#a1a1aa" : "#52525b",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: isDark ? "#27272a" : "#e4e4e7" },
        horzLines: { color: isDark ? "#27272a" : "#e4e4e7" },
      },
      crosshair: {
        mode: CrosshairMode.MagnetOHLC,
        vertLine: { width: 1, color: isDark ? "#71717a" : "#a1a1aa", style: 2 },
        horzLine: { width: 1, color: isDark ? "#71717a" : "#a1a1aa", style: 2 },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
        tickMarkFormatter: (time: Time, tickType: TickMarkType) =>
          formatChartTickMark(time, tickType, tickLocale, displayTz, hour12),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    const bandsPrimitive = new RegimeBandsPrimitive();
    bandsPrimitive.setPalette(isDark ? REGIME_BAND_FILL_DARK : REGIME_BAND_FILL_LIGHT);
    chart.panes()[0]?.attachPrimitive(bandsPrimitive);
    regimeBandsPrimitiveRef.current = bandsPrimitive;

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || param.point === undefined) {
        setHoverOhlcv(null);
        return;
      }
      const candleBar = param.seriesData.get(candleSeries);
      const volBar = param.seriesData.get(volSeries);
      if (!candleBar || !("open" in candleBar) || !("close" in candleBar)) {
        setHoverOhlcv(null);
        return;
      }
      const o = candleBar as CandlestickData<Time>;
      let volume = 0;
      if (volBar && "value" in volBar && typeof (volBar as HistogramData<Time>).value === "number") {
        volume = (volBar as HistogramData<Time>).value;
      }
      const px = { x: Number(param.point.x), y: Number(param.point.y) };
      const pos = hoverTooltipLayout(el.clientWidth, el.clientHeight, px);

      let closeTimeLabel: string | null = null;
      if (typeof param.time === "number" && Number.isFinite(param.time)) {
        const hit = candlesRef.current.find((r) => candleTimeToUnixSeconds(r.openTime) === param.time);
        if (hit?.closeTime) {
          const closeSec = candleTimeToUnixSeconds(hit.closeTime);
          if (Number.isFinite(closeSec)) {
            closeTimeLabel = formatDatetime(new Date(closeSec * 1000), localePrefs, tzOpts);
          }
        }
      }

      setHoverOhlcv({
        timeLabel: formatChartCrosshairTime(param.time, displayTz, tickLocale, hour12),
        closeTimeLabel,
        open: o.open,
        high: o.high,
        low: o.low,
        close: o.close,
        volume,
        left: pos.left,
        top: pos.top,
        transform: pos.transform,
      });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    const ro = new ResizeObserver(() => {
      const cur = containerRef.current;
      const ch = chartRef.current;
      if (!cur || !ch) return;
      ch.applyOptions({
        width: cur.clientWidth,
        height: cur.clientHeight > 0 ? cur.clientHeight : 420,
      });
    });
    ro.observe(el);

    pushSeriesData(candlesRef.current);
    markersPluginRef.current.setMarkers(
      buildSignalMarkers(
        chartSignalsRef.current,
        enabledAgentsRef.current,
        showSignalConfidenceRef.current,
      ),
    );
    bandsPrimitive.setBands(
      showRegimeRef.current
        ? buildRegimeBands(regimeChangesRef.current, lastBarUnixSec(candlesRef.current))
        : [],
    );

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      ro.disconnect();
      try {
        markersPluginRef.current?.detach();
      } catch {
        /* chart.remove() also cleans primitives; ignore */
      }
      markersPluginRef.current = null;
      try {
        chart.panes()[0]?.detachPrimitive(bandsPrimitive);
      } catch {
        /* chart.remove() also cleans primitives; ignore */
      }
      regimeBandsPrimitiveRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      setHoverOhlcv(null);
    };
  }, [isDark, pushSeriesData, chartDisplayIana, tickLocale, hour12, localePrefs, tzOpts]);

  /** Push signal markers whenever signals, per-agent toggles, or the confidence toggle change. */
  useEffect(() => {
    const plugin = markersPluginRef.current;
    if (!plugin) return;
    plugin.setMarkers(buildSignalMarkers(chartSignals, enabledAgents, showSignalConfidence));
  }, [chartSignals, enabledAgents, showSignalConfidence]);

  /** Push regime background bands whenever regime data, the toggle, or candles change. */
  useEffect(() => {
    const prim = regimeBandsPrimitiveRef.current;
    if (!prim) return;
    prim.setBands(showRegime ? buildRegimeBands(regimeChanges, lastBarUnixSec(candles)) : []);
  }, [regimeChanges, showRegime, candles]);

  /** Re-tint regime bands when the active color scheme flips (light ↔ dark). */
  useEffect(() => {
    regimeBandsPrimitiveRef.current?.setPalette(
      isDark ? REGIME_BAND_FILL_DARK : REGIME_BAND_FILL_LIGHT,
    );
  }, [isDark]);

  useEffect(() => {
    pushSeriesData(candles);
  }, [candles, pushSeriesData]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  /**
   * Set on every successful background refresh (Supabase realtime push OR the polling
   * timer). Drives the "Live · updated Xs ago" badge in the toolbar; reset to `null`
   * when the marketId changes so we don't show stale "updated 12h ago" on navigation.
   */
  const [lastRefreshMs, setLastRefreshMs] = useState<number | null>(null);

  useEffect(() => {
    setLastRefreshMs(null);
    const supabase = createClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const flushRefetch = async () => {
      if (inFlight) return;
      inFlight = true;
      const tf = timeframeRef.current;
      try {
        const [candleRes, signalRes] = await Promise.all([
          fetch(`/api/markets/candles?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`),
          fetch(`/api/markets/signals?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`),
        ]);
        const candleBody = (await candleRes.json()) as {
          error?: string;
          candles?: CandleRowJson[];
          changePct?: number | null;
        };
        if (candleRes.ok && !candleBody.error) {
          // pushSeriesData (driven by the [candles] effect) preserves the visible
          // range because fitOnNextPushRef stays false during background refreshes.
          setCandles(candleBody.candles ?? []);
          setChangePct(candleBody.changePct ?? computeChange(candleBody.candles ?? []));
        }
        const signalBody = (await signalRes.json()) as {
          error?: string;
          signals?: ChartSignal[];
          regimeChanges?: ChartRegimeChange[];
          regimeInsufficient?: RegimeInsufficientHistoryHint | null;
        };
        if (signalRes.ok && !signalBody.error) {
          setChartSignals(signalBody.signals ?? []);
          setRegimeChanges(signalBody.regimeChanges ?? []);
          setRegimeInsufficient(signalBody.regimeInsufficient ?? null);
        }
        setLastRefreshMs(Date.now());
      } catch {
        /* background refresh — ignore */
      } finally {
        inFlight = false;
      }
    };

    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void flushRefetch();
      }, 400);
    };

    const channel = supabase
      .channel(`candles-market-${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "catalog",
          table: "candles",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { timeframe?: string } | null;
          if (row?.timeframe !== CATALOG_STORAGE_TIMEFRAME) return;
          scheduleRefetch();
        },
      )
      .subscribe();

    // Polling fallback: realtime only fires on candle changes, but new signals (e.g.
    // after an Evaluate-signals run) don't push a candle event. The 15s timer makes
    // sure markers + regime bands catch up regardless. Skip when the tab is hidden so
    // we don't burn HTTP requests in background tabs; flush immediately on re-show.
    const pollInterval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      scheduleRefetch();
    }, CHART_LIVE_POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) scheduleRefetch();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollInterval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      void supabase.removeChannel(channel);
    };
  }, [marketId]);

  const loadTf = useCallback(
    async (tf: ChartTimeframe) => {
      setTimeframe(tf);
      setLoading(true);
      setError(null);
      // User-driven timeframe switch: fit content on the resulting data push so the
      // new range is visible end-to-end. Background polling leaves this flag false.
      fitOnNextPushRef.current = true;
      try {
        const [candleRes, signalRes] = await Promise.all([
          fetch(`/api/markets/candles?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`),
          fetch(`/api/markets/signals?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`),
        ]);
        const candleBody = (await candleRes.json()) as {
          error?: string;
          candles?: CandleRowJson[];
          changePct?: number | null;
        };
        if (!candleRes.ok) {
          setError(candleBody.error ?? "Failed to load");
          return;
        }
        setCandles(candleBody.candles ?? []);
        setChangePct(candleBody.changePct ?? computeChange(candleBody.candles ?? []));

        const signalBody = (await signalRes.json()) as {
          error?: string;
          signals?: ChartSignal[];
          regimeChanges?: ChartRegimeChange[];
          regimeInsufficient?: RegimeInsufficientHistoryHint | null;
        };
        if (signalRes.ok && !signalBody.error) {
          setChartSignals(signalBody.signals ?? []);
          setRegimeChanges(signalBody.regimeChanges ?? []);
          setRegimeInsufficient(signalBody.regimeInsufficient ?? null);
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    },
    [marketId],
  );

  const lastPrice = useMemo(() => {
    if (!candles.length) return null;
    return candles[candles.length - 1]!.close;
  }, [candles]);

  const envOverride = Boolean(
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE?.trim(),
  );

  return (
    <>
      {expanded ? (
        <div
          onClick={() => setExpanded(false)}
          aria-hidden="true"
          className="fixed inset-0 z-[100] bg-black/45"
        />
      ) : null}
      <Card
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        aria-label={expanded ? "Price chart fullscreen" : undefined}
        className={expanded ? "fixed inset-4 z-[101] flex flex-col overflow-hidden" : undefined}
      >
        <CardBody className={expanded ? "flex h-full min-h-0 flex-1 flex-col" : undefined}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="bk-form-label" style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              Price chart
            </h2>
            <p className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
              Candlesticks + volume · ENTER / ADD / REDUCE / EXIT signal markers · BULL / BEAR / SIDE regime bands
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge lastRefreshMs={lastRefreshMs} pollIntervalMs={CHART_LIVE_POLL_INTERVAL_MS} />
            {CHART_TIMEFRAMES.map((tf) => (
              <Button
                key={tf}
                type="button"
                variant={timeframe === tf ? "brand" : "neutral"}
                size="sm"
                disabled={loading}
                onClick={() => void loadTf(tf)}
              >
                {tf}
              </Button>
            ))}
            <Button
              type="button"
              variant={showCandleInfo ? "brand" : "neutral"}
              size="sm"
              onClick={() => setShowCandleInfo((v) => !v)}
              aria-pressed={showCandleInfo}
              aria-label={showCandleInfo ? "Hide candle info popup" : "Show candle info popup"}
              title={showCandleInfo ? "Hide OHLCV hover popup" : "Show OHLCV hover popup"}
            >
              {showCandleInfo ? "Info on" : "Info off"}
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-pressed={expanded}
              aria-label={expanded ? "Collapse price chart" : "Expand price chart"}
              title={expanded ? "Collapse (Esc)" : "Expand"}
            >
              {expanded ? "Collapse" : "Expand"}
            </Button>
          </div>
        </div>

        <div
          className="mt-3 flex flex-wrap items-baseline gap-4 border-b pb-3"
          style={{ borderColor: "var(--bk-color-border)" }}
        >
          {lastPrice != null ? (
            <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--bk-color-text)" }}>
              {formatPrice(lastPrice)}
            </span>
          ) : (
            <span className="bk-text-muted text-sm">No OHLCV yet</span>
          )}
          {changePct != null && Number.isFinite(changePct) ? (
            <span
              className="text-sm font-medium tabular-nums"
              style={{ color: changePct >= 0 ? "var(--bk-color-success)" : "var(--bk-color-error)" }}
            >
              {changePct >= 0 ? "+" : ""}
              {formatDecimal(changePct, localePrefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%{" "}
              <span className="font-normal bk-text-muted">(in view)</span>
            </span>
          ) : null}
          {loading ? <span className="bk-text-muted text-xs">Loading…</span> : null}
          {error ? (
            <span className="text-xs" style={{ color: "var(--bk-color-error)" }}>
              {error}
            </span>
          ) : null}
        </div>

        {regimeChanges.length > 0 || regimeInsufficient != null ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="bk-text-muted text-xs uppercase tracking-wide"
              title="Bull / bear / sideways regime bands from the regime-classifier-15m-v1 agent"
            >
              Regime
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: REGIME_BULL_COLOR }}
              />
              <span className="bk-text-muted">BULL</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: REGIME_BEAR_COLOR }}
              />
              <span className="bk-text-muted">BEAR</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: REGIME_SIDEWAYS_COLOR }}
              />
              <span className="bk-text-muted">SIDE</span>
            </span>
            {regimeChanges.length > 0 ? (
              <>
                <span className="bk-text-muted text-xs">·</span>
                <button
                  type="button"
                  onClick={() => setShowRegime((v) => !v)}
                  aria-pressed={showRegime}
                  title={showRegime ? "Hide regime background bands" : "Show regime background bands"}
                  className="rounded border px-2 py-0.5 text-xs"
                  style={{
                    borderColor: showRegime ? "var(--bk-color-brand)" : "var(--bk-color-border)",
                    background: showRegime
                      ? "color-mix(in srgb, var(--bk-color-brand) 12%, transparent)"
                      : "transparent",
                    color: showRegime ? "var(--bk-color-text)" : "var(--bk-color-text-muted)",
                    opacity: showRegime ? 1 : 0.7,
                  }}
                >
                  {showRegime ? "Hide" : "Show"}
                </button>
                <span className="bk-text-muted text-xs tabular-nums">
                  {regimeChanges.length} {regimeChanges.length === 1 ? "period" : "periods"}
                </span>
              </>
            ) : null}
            {regimeInsufficient != null
              ? (() => {
                  const tfLabel = formatTrendTimeframeLabel(regimeInsufficient.trendTimeframeMinutes);
                  const memoryHint = formatTrendMemoryHint(
                    regimeInsufficient.needBars,
                    regimeInsufficient.trendTimeframeMinutes,
                  );
                  const unitWord = tfLabel ? `${tfLabel} bars` : "bars";
                  const titleMemory = memoryHint ? ` (${memoryHint})` : "";
                  return (
                    <>
                      <span className="bk-text-muted text-xs">·</span>
                      <span
                        className="rounded border px-2 py-0.5 text-xs tabular-nums"
                        title={`The regime classifier needs ${regimeInsufficient.needBars} ${unitWord}${titleMemory} of history before it can label bull/bear/sideways. As of the most recent classifier signal it had ${regimeInsufficient.haveBars}. Backfill more candles and re-evaluate signals (regime classifier) to populate the missing range.`}
                        style={{
                          borderColor: "var(--bk-color-warning, var(--bk-color-border))",
                          background:
                            "color-mix(in srgb, var(--bk-color-warning, var(--bk-color-border)) 10%, transparent)",
                          color: "var(--bk-color-text-muted)",
                        }}
                      >
                        Insufficient history · {regimeInsufficient.haveBars}/{regimeInsufficient.needBars} {unitWord}
                      </span>
                    </>
                  );
                })()
              : null}
          </div>
        ) : null}

        {agentSlugs.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="bk-text-muted text-xs uppercase tracking-wide"
              title="Toggle which signal agents draw markers on the chart"
            >
              Signals
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-0 w-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderBottom: `7px solid ${MARKER_ENTRY_COLOR}`,
                }}
              />
              <span className="bk-text-muted">ENTER / ADD</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-0 w-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: `7px solid ${MARKER_EXIT_COLOR}`,
                }}
              />
              <span className="bk-text-muted">EXIT / REDUCE</span>
            </span>
            <span className="bk-text-muted text-xs">·</span>
            <button
              type="button"
              onClick={() => setAllAgents(!allAgentsEnabled)}
              className="rounded border px-2 py-0.5 text-xs"
              style={{
                borderColor: "var(--bk-color-border)",
                color: "var(--bk-color-text-muted)",
              }}
              aria-pressed={allAgentsEnabled}
              title={allAgentsEnabled ? "Hide all signal markers" : "Show all signal markers"}
            >
              {allAgentsEnabled ? "Hide all" : "Show all"}
            </button>
            <button
              type="button"
              onClick={() => setShowSignalConfidence((v) => !v)}
              aria-pressed={showSignalConfidence}
              title={
                showSignalConfidence
                  ? "Hide confidence percentage on signal markers"
                  : "Show confidence percentage on signal markers (e.g. ENTER 75%)"
              }
              className="rounded border px-2 py-0.5 text-xs"
              style={{
                borderColor: showSignalConfidence ? "var(--bk-color-brand)" : "var(--bk-color-border)",
                background: showSignalConfidence
                  ? "color-mix(in srgb, var(--bk-color-brand) 12%, transparent)"
                  : "transparent",
                color: showSignalConfidence ? "var(--bk-color-text)" : "var(--bk-color-text-muted)",
                opacity: showSignalConfidence ? 1 : 0.7,
              }}
            >
              {showSignalConfidence ? "Conf on" : "Conf off"}
            </button>
            {agentSlugs.map((slug) => {
              const on = enabledAgents.has(slug);
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleAgent(slug)}
                  aria-pressed={on}
                  title={on ? `Hide ${slug} markers` : `Show ${slug} markers`}
                  className="rounded border px-2 py-0.5 font-mono text-xs"
                  style={{
                    borderColor: on ? "var(--bk-color-brand)" : "var(--bk-color-border)",
                    background: on ? "color-mix(in srgb, var(--bk-color-brand) 12%, transparent)" : "transparent",
                    color: on ? "var(--bk-color-text)" : "var(--bk-color-text-muted)",
                    opacity: on ? 1 : 0.7,
                  }}
                >
                  {slug}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          className={
            expanded
              ? "relative mt-2 w-full min-w-0 flex-1 min-h-0"
              : "relative mt-2 min-h-[420px] w-full min-w-0"
          }
        >
          <div
            ref={containerRef}
            className={expanded ? "h-full w-full min-w-0" : "h-[420px] w-full min-w-0"}
          />
          {hoverOhlcv && showCandleInfo ? (
            <div
              className="bk-chart-tooltip"
              style={{
                left: hoverOhlcv.left,
                top: hoverOhlcv.top,
                transform: hoverOhlcv.transform,
              }}
              aria-live="polite"
            >
              <p className="text-sm font-medium" style={{ color: "var(--bk-color-text)" }}>
                {hoverOhlcv.timeLabel}
              </p>
              <dl
                className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums bk-text-muted"
                style={{ fontSize: "0.75rem" }}
              >
                <dt className="opacity-80" title="catalog.candle_timestamps.close_time">
                  Bar closes
                </dt>
                <dd className="text-right font-mono" style={{ color: "var(--bk-color-text)" }}>
                  {hoverOhlcv.closeTimeLabel ?? "—"}
                </dd>
                <dt className="opacity-80">O</dt>
                <dd className="text-right" style={{ color: "var(--bk-color-text)" }}>
                  {formatPrice(hoverOhlcv.open)}
                </dd>
                <dt className="opacity-80">H</dt>
                <dd className="text-right" style={{ color: "var(--bk-color-text)" }}>
                  {formatPrice(hoverOhlcv.high)}
                </dd>
                <dt className="opacity-80">L</dt>
                <dd className="text-right" style={{ color: "var(--bk-color-text)" }}>
                  {formatPrice(hoverOhlcv.low)}
                </dd>
                <dt className="opacity-80">C</dt>
                <dd className="text-right" style={{ color: "var(--bk-color-text)" }}>
                  {formatPrice(hoverOhlcv.close)}
                </dd>
                <dt className="opacity-80">V</dt>
                <dd className="text-right" style={{ color: "var(--bk-color-text)" }}>
                  {formatVolume(hoverOhlcv.volume)}
                </dd>
              </dl>
            </div>
          ) : null}
        </div>

        {expanded ? null : (
          <p className="bk-text-muted mt-2" style={{ fontSize: "0.75rem" }}>
            Axis, crosshair, and hover labels use <strong className="font-mono">{chartDisplayIana}</strong>
            {envOverride ? (
              <>
                {" "}
                (<code className="bk-code">NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE</code> overrides your saved timezone for this
                chart only).
              </>
            ) : (
              <> (from your display settings).</>
            )}{" "}
            Bars stay the same UTC instants as Supabase <code className="bk-code">open_time</code> /{" "}
            <code className="bk-code">close_time</code>. If the chart is empty, refresh listings from{" "}
            <Link href="/markets" className="bk-link">
              Markets
            </Link>
            . Gaps usually mean no row for that 15m slot; in the SQL editor, compare consecutive{" "}
            <code className="bk-code">close_time</code> values (difference{">"} 16 minutes) to find missing bars.
          </p>
        )}
        </CardBody>
      </Card>
    </>
  );
}
