/**
 * Shell navigation item (Salesforce-style app tab / navigation menu item).
 * Parent context lives on `AppMetadata`, not on each tab.
 */
export type TabMetadata = {
  /** Stable id for keys and routing, e.g. first URL segment */
  slug: string;
  label: string;
  order?: number;
  icon?: string;
  /** Internal path (e.g. `/overview`) or external URL when prefixed accordingly */
  href?: string;
  /**
   * Optional shell grouping: consecutive tabs with the same `section` render inside one dropdown
   * (see `AppSchemaNav`).
   */
  section?: string;
};
