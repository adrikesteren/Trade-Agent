import type { AppMetadata } from "@repo/adricore/metadata";
import { DEFAULT_APP_ID } from "@repo/adricore/metadata";
import { getTabBySlug as resolveTabInApp } from "@repo/adricore/platform";

/**
 * Trade Agent dashboard: all shell apps (`AppMetadata` per registry key).
 * Cookie `ACTIVE_APP_COOKIE_NAME` selects which entry is active; invalid/missing → `DEFAULT_APP_ID`.
 */
export const appRegistry = {
  [DEFAULT_APP_ID]: {
    label: "Full workspace",
    tabs: [
      { slug: "overview", label: "Overview", href: "/overview", order: 0 },
      { slug: "preferences", label: "Preferences", href: "/me/preferences", order: 1 },
      { slug: "assets", label: "Assets", href: "/assets", order: 10, section: "Catalog" },
      { slug: "markets", label: "Markets", href: "/markets", order: 11, section: "Catalog" },
      { slug: "exchanges", label: "Exchanges", href: "/exchanges", order: 12, section: "Catalog" },
      { slug: "signals", label: "Signals", href: "/signals", order: 20, section: "Trading" },
      { slug: "signal-agents", label: "Signal Agents", href: "/signal-agents", order: 21, section: "Trading" },
      { slug: "executors", label: "Executors", href: "/executors", order: 22, section: "Trading" },
      { slug: "tasks", label: "Tasks", href: "/tasks", order: 30 },
      { slug: "system-settings", label: "System settings", href: "/system-settings", order: 40 },
    ],
  },
  "catalog-focus": {
    label: "Catalog",
    tabs: [
      { slug: "overview", label: "Overview", href: "/overview", order: 0 },
      { slug: "preferences", label: "Preferences", href: "/me/preferences", order: 1 },
      { slug: "assets", label: "Assets", href: "/assets", order: 10, section: "Catalog" },
      { slug: "markets", label: "Markets", href: "/markets", order: 11, section: "Catalog" },
      { slug: "exchanges", label: "Exchanges", href: "/exchanges", order: 12, section: "Catalog" },
    ],
  },
} satisfies Record<string, AppMetadata>;

export type DashboardAppId = keyof typeof appRegistry;

export function resolveActiveAppId(cookieValue: string | undefined): DashboardAppId {
  if (cookieValue && Object.hasOwn(appRegistry, cookieValue)) {
    return cookieValue as DashboardAppId;
  }
  return DEFAULT_APP_ID;
}

export function getActiveAppMetadata(appId: string): AppMetadata {
  if (Object.hasOwn(appRegistry, appId)) {
    return appRegistry[appId as DashboardAppId];
  }
  return appRegistry[DEFAULT_APP_ID];
}

export function listDashboardAppSwitchOptions(): { id: DashboardAppId; label: string }[] {
  return (Object.keys(appRegistry) as DashboardAppId[]).map((id) => ({
    id,
    label: appRegistry[id].label ?? id,
  }));
}

export function getTabBySlug(app: AppMetadata, segment: string) {
  return resolveTabInApp(app, segment);
}
