import type * as React from "react";

export type PageHeaderVariant = "detail" | "list";

export type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * - `detail` — record page (object icon, brand-blue left border, highlights row, actions)
   * - `list`   — Lightning list view (object icon, picker, summary, toolbar)
   */
  variant?: PageHeaderVariant;
  /** Lightning-style object icon (letter or custom node). */
  icon?: React.ReactNode;
  /** Title-row suffix (e.g. list-view picker chevron). */
  titleAddon?: React.ReactNode;
  /** Metadata strip beneath title (`"50+ items • Sorted by …"`). List variant only. */
  summary?: React.ReactNode;
  /** Bottom row (search + icon controls). List variant only. */
  toolbar?: React.ReactNode;
  /** Read-only key fields under the title (`<Output>` row). Detail variant only. */
  highlights?: React.ReactNode;
  /** Extra classes on the `<h1>`. */
  titleClassName?: string;
  className?: string;
};
