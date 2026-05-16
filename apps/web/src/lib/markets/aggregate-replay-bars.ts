/**
 * Roll up an ascending series of bars (open/high/low/close/volume/closeTimeIso)
 * into a larger timeframe in-memory. Buckets are epoch-aligned on the **open**
 * time (closeTime − sourceTfMs) so 15m → 4h aligns to 00:00, 04:00, 08:00, ...
 * and 15m → 1d aligns to 00:00 UTC.
 *
 * This is the "lite" sibling of {@link aggregateOhlcvToTarget}: it works on a
 * plain bar shape (no `CandleRowJson` round-trip) so signal evaluators can
 * consume it directly without converting through chart types.
 *
 * Contract:
 * - `barsAsc` is the input series (15m by default). It MUST be sorted
 *   ascending by `closeTimeIso`. The function does not re-sort to avoid an
 *   O(n log n) hit on hot signal paths; pass a presorted slice.
 * - `targetTfMinutes` MUST be a multiple of `sourceTfMinutes` (default `15`).
 *   Supported in this codebase: `60`, `240`, `1440`.
 * - Volumes are summed across the bucket (or `0` when missing).
 * - `closeTimeIso` of the output bar = `bucketOpenMs + targetTfMs` to match
 *   the convention used elsewhere in the catalog (exchange close = bucket end).
 *
 * The helper is intentionally pure and side-effect free. Tests live alongside
 * in `aggregate-replay-bars.test.ts`.
 */

export type ReplayBar = {
  open?: number;
  /** Optional — falls back to `close` when missing (some upstream callers only carry close on 15m). */
  high?: number;
  /** Optional — falls back to `close` when missing. */
  low?: number;
  close: number;
  volume?: number;
  closeTimeIso: string;
};

export type AggregatedBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTimeIso: string;
};

export function aggregateReplayBarsToTimeframe(
  barsAsc: ReplayBar[],
  targetTfMinutes: number,
  options?: { sourceTfMinutes?: number },
): AggregatedBar[] {
  const sourceTfMinutes = options?.sourceTfMinutes ?? 15;
  if (sourceTfMinutes <= 0 || !Number.isFinite(sourceTfMinutes)) {
    throw new Error(`aggregateReplayBarsToTimeframe: invalid sourceTfMinutes=${sourceTfMinutes}`);
  }
  if (targetTfMinutes <= 0 || !Number.isFinite(targetTfMinutes)) {
    throw new Error(`aggregateReplayBarsToTimeframe: invalid targetTfMinutes=${targetTfMinutes}`);
  }
  if (targetTfMinutes % sourceTfMinutes !== 0) {
    throw new Error(
      `aggregateReplayBarsToTimeframe: targetTfMinutes (${targetTfMinutes}) must be a multiple of sourceTfMinutes (${sourceTfMinutes})`,
    );
  }
  if (!barsAsc.length) return [];

  const sourceTfMs = sourceTfMinutes * 60_000;
  const targetTfMs = targetTfMinutes * 60_000;

  type Bucket = {
    openMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    lastCloseMs: number;
  };

  const buckets = new Map<number, Bucket>();

  for (const bar of barsAsc) {
    const closeMs = Date.parse(bar.closeTimeIso);
    if (!Number.isFinite(closeMs)) continue;
    const openMs = closeMs - sourceTfMs;
    const bucketOpenMs = Math.floor(openMs / targetTfMs) * targetTfMs;

    const existing = buckets.get(bucketOpenMs);
    const open = bar.open ?? bar.close;
    const vol = bar.volume ?? 0;
    const high = bar.high ?? bar.close;
    const low = bar.low ?? bar.close;
    if (existing) {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.volume += vol;
      if (closeMs > existing.lastCloseMs) {
        existing.close = bar.close;
        existing.lastCloseMs = closeMs;
      }
    } else {
      buckets.set(bucketOpenMs, {
        openMs: bucketOpenMs,
        open,
        high,
        low,
        close: bar.close,
        volume: vol,
        lastCloseMs: closeMs,
      });
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return keys.map((k) => {
    const b = buckets.get(k)!;
    return {
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      closeTimeIso: new Date(b.openMs + targetTfMs).toISOString(),
    };
  });
}
