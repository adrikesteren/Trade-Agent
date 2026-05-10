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
  className,
}: RecordRelatedListProps<T>) {
  const total = totalCount ?? items.length;
  const visible = items.slice(0, previewLimit);
  const hasMore = total > previewLimit;
  const showViewAll = Boolean(viewAllHref && hasMore);

  return (
    <section className={cx("bk-record-detail-section bk-record-related-list", className)}>
      <header className="bk-record-related-list_header">
        <div className="bk-record-related-list_titles">
          <h2 className="bk-record-detail-section_title">{title}</h2>
          {description ? <div className="bk-record-detail-section_desc">{description}</div> : null}
        </div>
        {showViewAll ? (
          <a href={viewAllHref} className={listViewOutlineActionClass}>
            {viewAllLabel}
          </a>
        ) : null}
      </header>
      <div className="bk-record-detail-section_body">
        <ul className="bk-list-divided">
          {visible.length === 0 ? (
            <li className="bk-text-muted py-4" style={{ fontSize: "0.8125rem" }}>
              {emptyMessage}
            </li>
          ) : (
            visible.map((item) => (
              <li key={getKey(item)} className="bk-record-related-list_row">
                {renderRow(item)}
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
