import * as React from "react";
import { cx } from "../../lib/cx";
import { listViewOutlineActionClass } from "../list-view/outline-action";

export type RecordRelatedListProps<T> = {
  title: string;
  /** Optional small icon next to the title (e.g. a `<ListViewObjectIcon letter="O" />`). */
  icon?: React.ReactNode;
  /** Optional total count rendered next to the title as "(N)". Falls back to `totalCount`, then `items.length`. */
  count?: number;
  description?: React.ReactNode;
  /** All items already returned (parent slices server-side or passes everything). */
  items: readonly T[];
  getKey: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  /** Max rows rendered inline (default 6). */
  previewLimit?: number;
  /** Total matching rows when the parent query is capped (Supabase `count: "exact"`). */
  totalCount?: number;
  /** Shown when `items.length === 0`. */
  emptyMessage?: string;
  /** Bottom-of-card link (e.g. full list view, related route). */
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Show View all even if total <= previewLimit (useful for "open full list" links). */
  alwaysShowViewAll?: boolean;
  /** Header-right actions (e.g. a "New" button). */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Self-contained Salesforce-style related list card.
 *
 * Layout: header bar (icon + title + (N) + actions) → divided rows → footer "View all".
 * Render this directly under `RecordPageTabs` / wherever a related list lives — it does
 * **not** need to be wrapped in `<RecordPageCard>`.
 */
export function RecordRelatedList<T>({
  title,
  icon,
  count,
  description,
  items,
  getKey,
  renderRow,
  previewLimit = 6,
  totalCount,
  emptyMessage = "No related records.",
  viewAllHref,
  viewAllLabel = "View all",
  alwaysShowViewAll = false,
  actions,
  className,
}: RecordRelatedListProps<T>) {
  const total = totalCount ?? items.length;
  const headerCount = count ?? total;
  const visible = items.slice(0, previewLimit);
  const hasMore = total > previewLimit;
  const showViewAll = Boolean(viewAllHref && (hasMore || alwaysShowViewAll));

  return (
    <section className={cx("bk-related-list", className)}>
      <header className="bk-related-list_header">
        <div className="bk-related-list_header-main">
          {icon ? <div className="bk-related-list_icon">{icon}</div> : null}
          <div className="bk-related-list_titles">
            <h2 className="bk-related-list_title">
              {title}
              {Number.isFinite(headerCount) ? (
                <span className="bk-related-list_count" aria-label={`${headerCount} items`}>
                  ({headerCount})
                </span>
              ) : null}
            </h2>
            {description ? <div className="bk-related-list_desc">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="bk-related-list_actions">{actions}</div> : null}
      </header>

      <ul className="bk-related-list_rows">
        {visible.length === 0 ? (
          <li className="bk-related-list_empty">{emptyMessage}</li>
        ) : (
          visible.map((item) => (
            <li key={getKey(item)} className="bk-related-list_row">
              {renderRow(item)}
            </li>
          ))
        )}
      </ul>

      {showViewAll ? (
        <footer className="bk-related-list_footer">
          <a href={viewAllHref} className={listViewOutlineActionClass}>
            {viewAllLabel}
            {hasMore ? <span className="bk-related-list_more"> · {total}</span> : null}
          </a>
        </footer>
      ) : null}
    </section>
  );
}
