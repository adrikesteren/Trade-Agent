import type { AppMetadata } from "../metadata/app-metadata";
import type { TabMetadata } from "../metadata/tab-metadata";

/** Resolve a tab by its `slug` within an app’s `AppMetadata`. */
export function getTabBySlug(app: AppMetadata, segment: string): TabMetadata | undefined {
  return app.tabs.find((t) => t.slug === segment);
}

export function getTabHref(tab: TabMetadata): string {
  return tab.href ?? `/${tab.slug}`;
}
