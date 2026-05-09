"use client";

import type { CandleRowJson, ChartTimeframe } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME, CHART_TIMEFRAMES } from "@/lib/markets/chart-types";
import { getChartDisplayTimeZone } from "@/lib/markets/chart-display-timezone";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatChartCrosshairTime(t: Time, timeZone: string): string {
  if (typeof t !== "number" || !Number.isFinite(t)) return String(t);
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
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
function formatChartTickMark(time: Time, tickMarkType: TickMarkType, locale: string, timeZone: string): string | null {
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  const d = new Date(time * 1000);
  const loc = locale || undefined;
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
        return max(
          new Intl.DateTimeFormat(loc, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
        );
      case TickMarkType.TimeWithSeconds:
        return max(
          new Intl.DateTimeFormat(loc, {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
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

function fmtPrice(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function fmtVol(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Tooltip placement next to crosshair (chart-local px), CoinGecko-style: prefer right of cursor, flip if needed. */
function hoverTooltipLayout(
  chartWidth: number,
  chartHeight: number,
  point: { readonly x: number; readonly y: number },
): { left: number; top: number; transform: string } {
  const gap = 20;
  const estW = 200;
  const estH = 128;
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

export function MarketCandleChart({ marketId, initialTimeframe, initialCandles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const volSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);

  const isDark = useIsDarkClass();

  const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
  const [candles, setCandles] = useState<CandleRowJson[]>(initialCandles);
  const [changePct, setChangePct] = useState<number | null>(() => computeChange(initialCandles));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverOhlcv, setHoverOhlcv] = useState<HoverOhlcv | null>(null);

  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;

  const candlesRef = useRef(candles);
  candlesRef.current = candles;

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

    const displayTz = getChartDisplayTimeZone();

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 420,
      localization: {
        timeFormatter: (t: Time) => formatChartCrosshairTime(t, displayTz),
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
        tickMarkFormatter: (time: Time, tickType: TickMarkType, loc: string) =>
          formatChartTickMark(time, tickType, loc, displayTz),
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
            closeTimeLabel = formatChartCrosshairTime(closeSec as UTCTimestamp, displayTz);
          }
        }
      }

      setHoverOhlcv({
        timeLabel: formatChartCrosshairTime(param.time, displayTz),
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
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      chartRef.current.timeScale().fitContent();
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
  }, [isDark, pushSeriesData]);

  useEffect(() => {
    pushSeriesData(candles);
  }, [candles, pushSeriesData]);

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

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Price chart</h2>
          <p className="text-xs text-zinc-500">
            Candlesticks + volume · OHLCV + bar close time in tooltip · auto fit
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CHART_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              disabled={loading}
              onClick={() => void loadTf(tf)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                timeframe === tf
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-4 border-b border-zinc-100 pb-3 dark:border-zinc-800">
        {lastPrice != null ? (
          <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {lastPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}
          </span>
        ) : (
          <span className="text-sm text-zinc-500">No OHLCV yet</span>
        )}
        {changePct != null && Number.isFinite(changePct) ? (
          <span
            className={`text-sm font-medium tabular-nums ${changePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(2)}% <span className="font-normal text-zinc-500">(in view)</span>
          </span>
        ) : null}
        {loading ? <span className="text-xs text-zinc-500">Loading…</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      <div className="relative mt-2 min-h-[420px] w-full min-w-0">
        <div ref={containerRef} className="h-[420px] w-full min-w-0" />
        {hoverOhlcv ? (
          <div
            className="pointer-events-none absolute z-10 w-[200px] rounded-md border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-sm dark:border-zinc-600 dark:bg-zinc-900/95"
            style={{
              left: hoverOhlcv.left,
              top: hoverOhlcv.top,
              transform: hoverOhlcv.transform,
            }}
            aria-live="polite"
          >
            <p className="font-medium text-zinc-700 dark:text-zinc-200">{hoverOhlcv.timeLabel}</p>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums text-zinc-600 dark:text-zinc-400">
              <dt className="text-zinc-400 dark:text-zinc-500" title="catalog.candle_timestamps.close_time">
                Bar closes
              </dt>
              <dd className="text-right font-mono text-zinc-800 dark:text-zinc-100">
                {hoverOhlcv.closeTimeLabel ?? "—"}
              </dd>
              <dt className="text-zinc-400 dark:text-zinc-500">O</dt>
              <dd className="text-right text-zinc-800 dark:text-zinc-100">{fmtPrice(hoverOhlcv.open)}</dd>
              <dt className="text-zinc-400 dark:text-zinc-500">H</dt>
              <dd className="text-right text-zinc-800 dark:text-zinc-100">{fmtPrice(hoverOhlcv.high)}</dd>
              <dt className="text-zinc-400 dark:text-zinc-500">L</dt>
              <dd className="text-right text-zinc-800 dark:text-zinc-100">{fmtPrice(hoverOhlcv.low)}</dd>
              <dt className="text-zinc-400 dark:text-zinc-500">C</dt>
              <dd className="text-right text-zinc-800 dark:text-zinc-100">{fmtPrice(hoverOhlcv.close)}</dd>
              <dt className="text-zinc-400 dark:text-zinc-500">V</dt>
              <dd className="text-right text-zinc-800 dark:text-zinc-100">{fmtVol(hoverOhlcv.volume)}</dd>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}
