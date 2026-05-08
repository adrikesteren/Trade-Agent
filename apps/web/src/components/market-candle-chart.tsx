"use client";

import type { CandleRowJson, ChartTimeframe } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME, CHART_TIMEFRAMES } from "@/lib/markets/chart-types";
import { candleTimeToUnixSeconds } from "@/lib/markets/candle-time";
import { createClient } from "@/lib/supabase/client";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatUtcChartTime(t: Time): string {
  if (typeof t !== "number" || !Number.isFinite(t)) return String(t);
  try {
    return (
      new Intl.DateTimeFormat(undefined, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(t * 1000)) + " UTC"
    );
  } catch {
    return new Date(t * 1000).toISOString();
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

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 420,
      localization: {
        timeFormatter: formatUtcChartTime,
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

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      chartRef.current.timeScale().fitContent();
    });
    ro.observe(el);

    pushSeriesData(candlesRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
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
          schema: "public",
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
          <p className="text-xs text-zinc-500">Candlesticks + volume · crosshair · auto fit</p>
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

      <div ref={containerRef} className="mt-2 h-[420px] w-full min-w-0" />
    </section>
  );
}
