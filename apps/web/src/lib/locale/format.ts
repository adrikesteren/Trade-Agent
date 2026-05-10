import type { UserDateFormat, UserDecimalFormat, UserLocalePreferences, UserTimeFormat } from "./types";
import { userTimezoneToIana } from "./timezones";

export type DateTimeInput = string | number | Date | null | undefined;

/** Optional overrides (e.g. chart axis uses `resolveChartDisplayIana` while prefs hold the user’s saved zone). */
export type LocaleFormatOptions = {
  timeZoneOverride?: string;
};

function parseInstant(input: DateTimeInput): Date | null {
  if (input === undefined || input === null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(input).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateLocaleForOrder(dateFormat: UserDateFormat): string {
  switch (dateFormat) {
    case "mdy":
      return "en-US";
    case "ymd":
      return "sv-SE";
    case "dmy":
    default:
      return "nl-NL";
  }
}

function numberLocaleForDecimals(decimalFormat: UserDecimalFormat): string {
  switch (decimalFormat) {
    case "period_decimal":
      return "en-US";
    case "apostrophe_decimal":
      return "de-CH";
    case "comma_decimal":
    default:
      return "nl-NL";
  }
}

function hour12FromPrefs(timeFormat: UserTimeFormat): boolean {
  return timeFormat === "h12";
}

function effectiveIana(prefs: UserLocalePreferences, opts?: LocaleFormatOptions): string {
  return opts?.timeZoneOverride?.trim() || userTimezoneToIana(prefs.timezone);
}

function baseOptions(prefs: UserLocalePreferences, opts?: LocaleFormatOptions) {
  return {
    timeZone: effectiveIana(prefs, opts),
    hour12: hour12FromPrefs(prefs.time_format),
  } as const;
}

/** BCP-47 locale hint for date component order (used by chart ticks). */
export function dateOrderLocale(dateFormat: UserDateFormat): string {
  return dateLocaleForOrder(dateFormat);
}

/** Empty / invalid input renders em dash (same as `Output`). */
export function formatDate(value: DateTimeInput, prefs: UserLocalePreferences, opts?: LocaleFormatOptions): string {
  const d = parseInstant(value);
  if (!d) return "—";
  const loc = dateLocaleForOrder(prefs.date_format);
  return new Intl.DateTimeFormat(loc, {
    ...baseOptions(prefs, opts),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatTime(value: DateTimeInput, prefs: UserLocalePreferences, opts?: LocaleFormatOptions): string {
  const d = parseInstant(value);
  if (!d) return "—";
  const loc = dateLocaleForOrder(prefs.date_format);
  return new Intl.DateTimeFormat(loc, {
    ...baseOptions(prefs, opts),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function formatDatetime(value: DateTimeInput, prefs: UserLocalePreferences, opts?: LocaleFormatOptions): string {
  const d = parseInstant(value);
  if (!d) return "—";
  const loc = dateLocaleForOrder(prefs.date_format);
  return new Intl.DateTimeFormat(loc, {
    ...baseOptions(prefs, opts),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export type FormatDecimalOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  notation?: Intl.NumberFormatOptions["notation"];
};

export function formatDecimal(
  value: string | number | null | undefined,
  prefs: UserLocalePreferences,
  options?: FormatDecimalOptions,
): string {
  if (value === undefined || value === null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const loc = numberLocaleForDecimals(prefs.decimal_format);
  const min = options?.minimumFractionDigits ?? 0;
  const max = options?.maximumFractionDigits ?? Math.min(8, min + 8);
  return new Intl.NumberFormat(loc, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    notation: options?.notation ?? "standard",
  }).format(n);
}

function parseFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** USD amounts (CoinGecko, etc.): currency stays USD; grouping/decimal style follows `decimal_format`. */
export function formatUsdAmount(
  value: string | number | null | undefined,
  prefs: UserLocalePreferences,
  opts?: { compactAbove?: number },
): string {
  const n = parseFiniteNumber(value);
  if (n === null) return "—";
  const loc = numberLocaleForDecimals(prefs.decimal_format);
  const compact = opts?.compactAbove != null && Math.abs(n) >= opts.compactAbove;
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2,
  }).format(n);
}

export function formatUsdSigned(
  value: string | number | null | undefined,
  prefs: UserLocalePreferences,
): string {
  const n = parseFiniteNumber(value);
  if (n === null) return "—";
  const loc = numberLocaleForDecimals(prefs.decimal_format);
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency: "USD",
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatPercentSigned(value: string | number | null | undefined, prefs: UserLocalePreferences): string {
  const n = parseFiniteNumber(value);
  if (n === null) return "—";
  const body = formatDecimal(n, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return `+${body}%`;
  return `${body}%`;
}

/** Bound formatters for passing into components / `Output`. */
export function createLocaleFormatters(prefs: UserLocalePreferences) {
  return {
    formatDate: (v: DateTimeInput) => formatDate(v, prefs),
    formatTime: (v: DateTimeInput) => formatTime(v, prefs),
    formatDatetime: (v: DateTimeInput) => formatDatetime(v, prefs),
    formatDecimal: (v: string | number | null | undefined, o?: FormatDecimalOptions) => formatDecimal(v, prefs, o),
    prefs,
    chartDisplayIana: userTimezoneToIana(prefs.timezone),
  };
}
