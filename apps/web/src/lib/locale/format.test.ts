import { describe, expect, it } from "vitest";
import { DEFAULT_USER_LOCALE_PREFERENCES } from "./defaults";
import { formatDate, formatDatetime, formatDecimal, formatTime } from "./format";
import type { UserLocalePreferences } from "./types";

const AMS: UserLocalePreferences = {
  ...DEFAULT_USER_LOCALE_PREFERENCES,
  timezone: "europe_amsterdam",
  decimal_format: "comma_decimal",
  date_format: "dmy",
  time_format: "h24",
};

/** Fixed instant: 2026-01-15 14:30:00 UTC */
const FIXED_ISO = "2026-01-15T14:30:00.000Z";

describe("formatDatetime", () => {
  it("uses Amsterdam wall time for europe_amsterdam", () => {
    const s = formatDatetime(FIXED_ISO, AMS);
    expect(s).not.toContain("T");
    expect(s.length).toBeGreaterThan(4);
  });

  it("respects timeZoneOverride for chart-style display", () => {
    const utcPrefs: UserLocalePreferences = { ...AMS, timezone: "europe_amsterdam" };
    const inUtc = formatDatetime(FIXED_ISO, utcPrefs, { timeZoneOverride: "UTC" });
    const inAms = formatDatetime(FIXED_ISO, utcPrefs);
    expect(inUtc).not.toEqual(inAms);
  });
});

describe("formatDate / formatTime", () => {
  it("formatDate returns date-only style string", () => {
    const d = formatDate(FIXED_ISO, AMS);
    expect(d).not.toContain("T");
  });

  it("formatTime includes clock parts", () => {
    const t = formatTime(FIXED_ISO, AMS);
    expect(t).toMatch(/\d/);
  });
});

describe("formatDecimal", () => {
  it("formats with comma decimal for nl-style prefs", () => {
    const s = formatDecimal(1234.5, AMS, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    expect(s).toContain(",");
  });

  it("formats with period decimal for US-style prefs", () => {
    const us: UserLocalePreferences = { ...AMS, decimal_format: "period_decimal" };
    const s = formatDecimal(1234.5, us, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    expect(s).toContain(".");
  });
});
