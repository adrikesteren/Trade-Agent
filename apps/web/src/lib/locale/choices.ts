import type { UserDateFormat, UserDecimalFormat, UserTimeFormat, UserTimezone } from "./types";

export const USER_TIMEZONE_CHOICES: { value: UserTimezone; label: string }[] = [
  { value: "europe_amsterdam", label: "Europe / Amsterdam" },
  { value: "utc", label: "UTC" },
  { value: "europe_london", label: "Europe / London" },
  { value: "europe_berlin", label: "Europe / Berlin" },
  { value: "america_new_york", label: "America / New York" },
  { value: "america_los_angeles", label: "America / Los Angeles" },
  { value: "asia_tokyo", label: "Asia / Tokyo" },
  { value: "australia_sydney", label: "Australia / Sydney" },
];

export const USER_DECIMAL_FORMAT_CHOICES: { value: UserDecimalFormat; label: string }[] = [
  { value: "comma_decimal", label: "1.234,56 (comma decimal)" },
  { value: "period_decimal", label: "1,234.56 (period decimal)" },
  { value: "apostrophe_decimal", label: "1’234,56 (apostrophe thousands, CH-style)" },
];

export const USER_DATE_FORMAT_CHOICES: { value: UserDateFormat; label: string }[] = [
  { value: "dmy", label: "Day–month–year" },
  { value: "mdy", label: "Month–day–year" },
  { value: "ymd", label: "Year–month–day" },
];

export const USER_TIME_FORMAT_CHOICES: { value: UserTimeFormat; label: string }[] = [
  { value: "h24", label: "24-hour" },
  { value: "h12", label: "12-hour (AM/PM)" },
];
