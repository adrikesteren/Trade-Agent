import * as React from "react";
import { cx } from "../lib/cx";
import { listViewOutlineActionClass } from "../list-view-classes";

export type RecordRelatedListProps<T> = {
  title: string;
  description?: React.ReactNode;
  /** All items returned for this relation (slice to preview client-side). */
  items: readonly T[];
  getKey: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  /** Max rows on the record page (default 10). */
  previewLimit?: number;
  /**
   * Total matching rows when the query is capped (e.g. Supabase `count: "exact"`).
   * If omitted, `items.length` is used (parent should pass every row, or set `totalCount`).
   */
  totalCount?: number;
  /** Shown when `items.length === 0`. */
  emptyMessage?: string;
  /** When more rows exist than the preview, this URL is used for the outline action (e.g. full list view). */
  viewAllHref?: string;
  viewAllLabel?: string;
  /** When true (with `viewAllHref`), show View all even if total ≤ previewLimit (e.g. link to expanded in-page view). */
  alwaysShowViewAll?: boolean;
  className?: string;
};

/**
 * Salesforce-style related list on a record page: titled block, first N rows, “View all” when more exist.
 */
export function RecordRelatedList<T>({
  title,
  description,
  items,
  getKey,
  renderRow,
  previewLimit = 10,
  totalCount,
  emptyMessage = "No related records.",
  viewAllHref,
  viewAllLabel = "View all",
  alwaysShowViewAll = false,
  className,
}: RecordRelatedListProps<T>) {
  const total = totalCount ?? items.length;
  const visible = items.slice(0, previewLimit);
  const hasMore = total > previewLimit;
  const showViewAll = Boolean(viewAllHref && (hasMore || alwaysShowViewAll));

  return (
    <section className={cx("adri-record-page-section adri-record-related-list", className)}>
      <header className="adri-record-related-list_header">
        <div className="adri-record-related-list_titles">
          <h2 className="adri-record-page-section_title">{title}</h2>
          {description ? <div className="adri-record-page-section_desc">{description}</div> : null}
        </div>
        {showViewAll ? (
          <a href={viewAllHref} className={listViewOutlineActionClass}>
            {viewAllLabel}
          </a>
        ) : null}
      </header>
      <div className="adri-record-page-section_body">
        <ul className="adri-list-divided">
          {visible.length === 0 ? (
            <li className="adri-text-muted py-4" style={{ fontSize: "0.8125rem" }}>
              {emptyMessage}
            </li>
          ) : (
            visible.map((item) => (
              <li key={getKey(item)} className="adri-record-related-list_row">
                {renderRow(item)}
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
