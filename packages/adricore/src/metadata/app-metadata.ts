import type { TabMetadata } from "./tab-metadata";

/**
 * HTTP-only cookie used by the host app to remember which `AppMetadata` entry
 * from its `Record<string, AppMetadata>` registry is active.
 */
export const ACTIVE_APP_COOKIE_NAME = "adricore_active_app" as const;

/**
 * Registry key to use when the cookie is missing or does not match any entry.
 * The product keeps a `Record<string, AppMetadata>`; this value must exist there.
 */
export const DEFAULT_APP_ID = "trade-agent" as const;

export type AppMetadata = {
  /** Shown in a multi-app switcher; optional when only one app exists. */
  label?: string;
  tabs: TabMetadata[];
};
