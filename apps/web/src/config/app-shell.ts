import { AppMetadataRegistry, AppMetadata, TabMetadataRegistry, ObjectTabMetadata, RouteTabMetadata, RouteMetadata, DEFAULT_APP_ID, ACTIVE_APP_COOKIE_NAME } from "@adrikesteren/adricore/metadata";
import { objectRegistry } from "../lib/objects/registry";
import { iconRegistry } from "../lib/objects/icons";

/**
 * Trade Agent dashboard: all shell apps (`AppMetadata` per registry key).
 * Cookie `ACTIVE_APP_COOKIE_NAME` selects which entry is active; invalid/missing â†’ `DEFAULT_APP_ID`.
 */

export const tabRegistry = new TabMetadataRegistry([
  new ObjectTabMetadata(objectRegistry.registrations.get("overview") || objectRegistry.registrations.get("assets")!, undefined, 0), // Will use external RouteTabMetadata later if Overview is just a route
  // For now we map standard objects to tabs:
  new RouteTabMetadata("overview", new RouteMetadata(iconRegistry.registrations.get("Activity")!, "/overview", "Overview"), undefined, 0),
  new RouteTabMetadata("preferences", new RouteMetadata(iconRegistry.registrations.get("Settings")!, "/me/preferences", "Preferences"), undefined, 1),
  new ObjectTabMetadata(objectRegistry.registrations.get("assets")!, "Catalog", 10),
  new ObjectTabMetadata(objectRegistry.registrations.get("markets")!, "Catalog", 11),
  new ObjectTabMetadata(objectRegistry.registrations.get("exchanges")!, "Catalog", 12),
  new ObjectTabMetadata(objectRegistry.registrations.get("signals")!, "Trading", 20),
  new ObjectTabMetadata(objectRegistry.registrations.get("signal_agents")!, "Trading", 21),
  new ObjectTabMetadata(objectRegistry.registrations.get("executors")!, "Trading", 22),
  new ObjectTabMetadata(objectRegistry.registrations.get("tasks")!, undefined, 30),
  new ObjectTabMetadata(objectRegistry.registrations.get("system_settings")!, undefined, 40)
]);

export const appRegistry = new AppMetadataRegistry([
  new AppMetadata(DEFAULT_APP_ID, "Full workspace", new TabMetadataRegistry(Array.from(tabRegistry.registrations.values()))),
  new AppMetadata("catalog-focus", "Catalog", new TabMetadataRegistry([
    tabRegistry.registrations.get("overview")!,
    tabRegistry.registrations.get("preferences")!,
    tabRegistry.registrations.get("assets")!,
    tabRegistry.registrations.get("markets")!,
    tabRegistry.registrations.get("exchanges")!
  ]))
]);

export type DashboardAppId = typeof DEFAULT_APP_ID | "catalog-focus";

export function resolveActiveAppId(cookieValue: string | undefined): DashboardAppId {
  if (cookieValue && appRegistry.registrations.has(cookieValue)) {
    return cookieValue as DashboardAppId;
  }
  return DEFAULT_APP_ID;
}

export function getActiveAppMetadata(appId: string): AppMetadata {
  return appRegistry.registrations.get(appId) || appRegistry.registrations.get(DEFAULT_APP_ID)!;
}

export function listDashboardAppSwitchOptions(): { id: DashboardAppId; label: string }[] {
  return Array.from(appRegistry.registrations.values()).map((app) => ({
    id: app.getApiName() as DashboardAppId,
    label: app.label,
  }));
}

export function getTabBySlug(app: AppMetadata, segment: string) {
  // Using apiName as slug identifier
  return app.tabRegistry.registrations.get(segment);
}
