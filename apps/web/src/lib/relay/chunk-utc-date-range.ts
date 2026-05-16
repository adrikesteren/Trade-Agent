/**
 * Splits an inclusive UTC `YYYY-MM-DD` date range into smaller, contiguous, non-overlapping
 * sub-ranges of at most `chunkDays` calendar days each. Used by the chunked Relay publishers
 * (`publishMarketBackfillCandlesChunkedRelay`, `publishMarketEvaluateAllSignalsChunkedRelay`)
 * to fan a long window out across multiple Relay messages in one message group.
 *
 * - Both bounds are **inclusive** (UTC days), matching `runMarketBackfillCandles`.
 * - Each chunk's `endDate` is the day **before** the next chunk's `startDate`, so coverage is
 *   exact and there is no overlap.
 * - Returns at least one chunk when `startDate <= endDate`. Throws on invalid inputs.
 *
 * Example: `chunkUtcDateRange("2025-01-01", "2025-03-15", 30)` returns roughly
 * `[ {2025-01-01, 2025-01-30}, {2025-01-31, 2025-03-01}, {2025-03-02, 2025-03-15} ]`.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type UtcDateChunk = {
  /** Inclusive UTC `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive UTC `YYYY-MM-DD`. */
  endDate: string;
};

function ymdToUtcDate(ymd: string): Date {
  if (!ISO_DATE_RE.test(ymd)) {
    throw new Error(`chunkUtcDateRange: invalid date "${ymd}" — expected YYYY-MM-DD.`);
  }
  // Force midnight UTC so day arithmetic is daylight-saving-free.
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`chunkUtcDateRange: invalid date "${ymd}" — could not parse.`);
  }
  return d;
}

function utcDateToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function chunkUtcDateRange(
  startDate: string,
  endDate: string,
  chunkDays: number,
): UtcDateChunk[] {
  const startMs = ymdToUtcDate(startDate).getTime();
  const endMs = ymdToUtcDate(endDate).getTime();
  if (startMs > endMs) {
    throw new Error(`chunkUtcDateRange: startDate (${startDate}) must be <= endDate (${endDate}).`);
  }
  if (!Number.isFinite(chunkDays) || chunkDays < 1) {
    throw new Error(`chunkUtcDateRange: chunkDays must be a positive integer (got ${chunkDays}).`);
  }
  const chunkDaysInt = Math.max(1, Math.floor(chunkDays));

  const out: UtcDateChunk[] = [];
  let cursorMs = startMs;
  while (cursorMs <= endMs) {
    // -1 day because both bounds are inclusive (a 30-day chunk spans day 0..day 29).
    const chunkEndMs = Math.min(endMs, cursorMs + (chunkDaysInt - 1) * MS_PER_DAY);
    out.push({
      startDate: utcDateToYmd(new Date(cursorMs)),
      endDate: utcDateToYmd(new Date(chunkEndMs)),
    });
    cursorMs = chunkEndMs + MS_PER_DAY;
  }
  return out;
}

/** Convert an inclusive UTC `YYYY-MM-DD` day to its `00:00:00.000Z` start-of-day ISO. */
export function ymdToStartOfDayIsoUtc(ymd: string): string {
  return `${ymdToUtcDate(ymd).toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Convert an inclusive UTC `YYYY-MM-DD` day to its `23:59:59.999Z` end-of-day ISO. */
export function ymdToEndOfDayIsoUtc(ymd: string): string {
  return `${ymdToUtcDate(ymd).toISOString().slice(0, 10)}T23:59:59.999Z`;
}
