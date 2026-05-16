/** Inclusive UTC date window expressed as `YYYY-MM-DD` strings. */
export type DateWindow = { startDate: string; endDate: string };

/** Default chunk size for "Backfill *" Relay enqueues. 5 days = 480 bars on the 15m catalog timeframe. */
export const RELAY_BACKFILL_WINDOW_CHUNK_DAYS = 5;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function parseUtcDateMs(ymd: string): number {
  if (!ISO_DATE_RE.test(ymd)) {
    throw new Error(`Invalid YYYY-MM-DD date: ${ymd}`);
  }
  const ms = Date.parse(`${ymd}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid date: ${ymd}`);
  }
  return ms;
}

function toUtcYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Splits the inclusive `[startDate, endDate]` UTC window into N-day chunks (last chunk may be shorter).
 * Returns at least one window. Throws on invalid input.
 */
export function splitDateRangeInChunks(startDate: string, endDate: string, chunkDays: number): DateWindow[] {
  if (!Number.isFinite(chunkDays) || chunkDays <= 0) {
    throw new Error("chunkDays must be a positive number");
  }
  const startMs = parseUtcDateMs(startDate);
  const endMs = parseUtcDateMs(endDate);
  if (startMs > endMs) {
    throw new Error("startDate must be on or before endDate");
  }

  const stepMs = Math.floor(chunkDays) * MS_PER_DAY;
  const out: DateWindow[] = [];
  let cursor = startMs;
  while (cursor <= endMs) {
    const chunkEnd = Math.min(cursor + stepMs - MS_PER_DAY, endMs);
    out.push({ startDate: toUtcYmd(cursor), endDate: toUtcYmd(chunkEnd) });
    cursor = chunkEnd + MS_PER_DAY;
  }
  return out;
}
