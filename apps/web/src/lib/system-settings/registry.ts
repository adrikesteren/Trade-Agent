import "server-only";

/** Keys stored in `public.system_settings`; keep in sync with seed migration. */
export const SYSTEM_SETTING_NUMERIC_KEYS = {
  EXCHANGE_CLOSE_QSTASH_STAGGER_SEC: "exchange_close_qstash_stagger_sec",
  EXCHANGE_CLOSE_QSTASH_PUBLISH_CONCURRENCY: "exchange_close_qstash_publish_concurrency",
} as const;

export type SystemSettingNumericKey =
  (typeof SYSTEM_SETTING_NUMERIC_KEYS)[keyof typeof SYSTEM_SETTING_NUMERIC_KEYS];

export type NumericSystemSettingDef = {
  key: SystemSettingNumericKey;
  label: string;
  description: string;
  /** When true, clearing / deleting the row could mean "use env default" (future); phase 1 uses seeded rows. */
  optional: boolean;
  /** When true, UI / save path must not persist an empty value (seeds satisfy this). */
  required: boolean;
  min: number;
  max: number;
  defaultValue: number;
  envFallbackVar: string;
  /** Integer floor for discrete settings (e.g. concurrency). */
  integer?: boolean;
};

const defs: readonly NumericSystemSettingDef[] = [
  {
    key: SYSTEM_SETTING_NUMERIC_KEYS.EXCHANGE_CLOSE_QSTASH_STAGGER_SEC,
    label: "Exchange close QStash stagger",
    description:
      "Seconds between each queued asset-close job when fan-out runs (decimals allowed). Stored in DB; overrides EXCHANGE_CLOSE_QSTASH_STAGGER_SEC without restarting the dev server.",
    optional: false,
    required: true,
    min: 0,
    max: 120,
    defaultValue: 2,
    envFallbackVar: "EXCHANGE_CLOSE_QSTASH_STAGGER_SEC",
  },
  {
    key: SYSTEM_SETTING_NUMERIC_KEYS.EXCHANGE_CLOSE_QSTASH_PUBLISH_CONCURRENCY,
    label: "Exchange close QStash publish concurrency",
    description:
      "Parallel QStash publish HTTP calls per wave in exchange-close-fan-out (1–128). Stored in DB; overrides EXCHANGE_CLOSE_QSTASH_PUBLISH_CONCURRENCY.",
    optional: false,
    required: true,
    min: 1,
    max: 128,
    defaultValue: 32,
    envFallbackVar: "EXCHANGE_CLOSE_QSTASH_PUBLISH_CONCURRENCY",
    integer: true,
  },
];

const byKey = new Map<SystemSettingNumericKey, NumericSystemSettingDef>(defs.map((d) => [d.key, d]));

export function listNumericSystemSettingDefs(): readonly NumericSystemSettingDef[] {
  return defs;
}

export function getNumericSystemSettingDef(key: string): NumericSystemSettingDef | undefined {
  return byKey.get(key as SystemSettingNumericKey);
}
