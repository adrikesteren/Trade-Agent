import "server-only";

/** Keys stored in `public.system_settings`; keep in sync with seed migration when adding tunables. */
export const SYSTEM_SETTING_NUMERIC_KEYS = {} as const;

export type SystemSettingNumericKey = keyof typeof SYSTEM_SETTING_NUMERIC_KEYS extends infer K
  ? [K] extends [never]
    ? string
    : K
  : string;

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

const defs: readonly NumericSystemSettingDef[] = [];

const byKey = new Map<SystemSettingNumericKey, NumericSystemSettingDef>(defs.map((d) => [d.key, d]));

export function listNumericSystemSettingDefs(): readonly NumericSystemSettingDef[] {
  return defs;
}

export function getNumericSystemSettingDef(key: string): NumericSystemSettingDef | undefined {
  return byKey.get(key as SystemSettingNumericKey);
}
