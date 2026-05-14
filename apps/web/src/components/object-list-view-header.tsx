import {
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
} from "@repo/adricore/blocks";
import type { ObjectMetadata } from "@repo/adricore/metadata";
import type { ReactNode } from "react";

/**
 * Metadata-driven Lightning list-view header.
 *
 * Pass `model={SomeObjectMetadata}` and the title + object icon are derived
 * from the model automatically (via `model.CreateListPageHeader(...)`).
 * `title` and `subtitle` are optional overrides for list-view names that
 * differ from the bare `label.plural`.
 */
export type ObjectListViewHeaderProps = {
  /** ObjectMetadata that drives title / icon / object label. */
  model: ObjectMetadata;
  /** Total rows currently loaded. */
  rowCount: number;
  /** Sort / status line displayed in the summary strip. */
  sortLine: string;
  /** Override the auto-derived summary entirely. */
  summary?: ReactNode;
  /** When true, summary omits the "Max N rows" segment (unbounded list). */
  uncapped?: boolean;
  maxRows?: number;
  /** Page-header right-side actions. */
  actions?: ReactNode;
  /** Optional toolbar slot (defaults to a `ListViewPlaceholderToolbar`). */
  toolbar?: ReactNode;
  /** Optional title-row addon (defaults to a `ListViewTitlePickerPlaceholder`). */
  titleAddon?: ReactNode;
  /** Override the title (default: `model.label.plural`). Use for named list views. */
  title?: ReactNode;
  /** Optional subtitle / description rendered under the title row. */
  subtitle?: ReactNode;
  /** Override the entire icon node. */
  icon?: ReactNode;
  /** Override the icon letter (default: first letter of `model.label.singular`). */
  iconLetter?: string;
};

const DEFAULT_MAX_ROWS = 200;

export function ObjectListViewHeader({
  model,
  rowCount,
  sortLine,
  summary,
  uncapped = false,
  maxRows = DEFAULT_MAX_ROWS,
  actions,
  toolbar,
  titleAddon,
  title,
  subtitle,
  icon,
  iconLetter,
}: ObjectListViewHeaderProps) {
  const summaryParts = [`${rowCount} row${rowCount === 1 ? "" : "s"}`, sortLine];
  if (!uncapped) summaryParts.push(`Max ${maxRows} rows`);
  const derivedSummary = summary ?? summaryParts.join(" · ");

  return model.CreateListPageHeader({
    rowCount,
    sortLine,
    summary: derivedSummary,
    uncapped,
    maxRows,
    actions,
    icon,
    iconLetter,
    title,
    subtitle,
    titleAddon: titleAddon ?? <ListViewTitlePickerPlaceholder />,
    toolbar: toolbar ?? <ListViewPlaceholderToolbar />,
  });
}
