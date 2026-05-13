"use client";

import { dateOrderLocale, formatDatetime, formatDecimal } from "@/lib/locale/format";
import type { UserDateFormat, UserDecimalFormat, UserLocalePreferences, UserTimeFormat, UserTimezone } from "@/lib/locale/types";
import type { CandleRowJson, ChartTimeframe } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME, CHART_TIMEFRAMES } from "@/lib/markets/chart-types";
import { candleTimeToUnixSeconds } from "@/lib/markets/candle-time";
import { createClient } from "@/lib/supabase/client";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  TickMarkType,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Button, Card, CardBody } from "@repo/adricore/blocks";
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

type Props = {
  marketId: string;
  initialTimeframe: ChartTimeframe;
  initialCandles: CandleRowJson[];
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

export function MarketCandleChart({
  marketId,
  initialTimeframe,
  initialCandles,
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
  const [changePct, setChangePct] = useState<number | null>(() => computeChange(initialCandles));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverOhlcv, setHoverOhlcv] = useState<HoverOhlcv | null>(null);
  const [expanded, setExpanded] = useState(false);

  const timeframeRef = useRef(timeframe);
  const candlesRef = useRef(candles);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

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
    chartRef.current?.timeScale().fitContent();
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

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      setHoverOhlcv(null);
    };
  }, [isDark, pushSeriesData, chartDisplayIana, tickLocale, hour12, localePrefs, tzOpts]);

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

  useEffect(() => {
    const supabase = createClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const flushRefetch = async () => {
      const tf = timeframeRef.current;
      try {
        const res = await fetch(
          `/api/markets/candles?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`,
        );
        const body = (await res.json()) as {
          error?: string;
          candles?: CandleRowJson[];
          changePct?: number | null;
        };
        if (!res.ok || body.error) return;
        setCandles(body.candles ?? []);
        setChangePct(body.changePct ?? computeChange(body.candles ?? []));
      } catch {
        /* background refresh — ignore */
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

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [marketId]);

  const loadTf = useCallback(
    async (tf: ChartTimeframe) => {
      setTimeframe(tf);
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/markets/candles?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}`,
        );
        const body = (await res.json()) as {
          error?: string;
          candles?: CandleRowJson[];
          changePct?: number | null;
        };
        if (!res.ok) {
          setError(body.error ?? "Failed to load");
          return;
        }
        setCandles(body.candles ?? []);
        setChangePct(body.changePct ?? computeChange(body.candles ?? []));
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
              Candlesticks + volume · OHLCV + bar close time in tooltip
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
          {hoverOhlcv ? (
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
