import * as React from "react";
import { cx } from "../../lib/cx";
import type { PageHeaderProps } from "./types";

/**
 * Record (Salesforce-style) page header.
 * Soft surface, brand-blue left border, big title with object icon, optional `highlights`
 * row beneath the title (read-only key fields), and primary actions on the right.
 */
export function PageHeaderDetail({
  title,
  subtitle,
  actions,
  icon,
  highlights,
  titleClassName,
  className,
}: Omit<PageHeaderProps, "variant" | "titleAddon" | "summary" | "toolbar">) {
  return (
    <header className={cx("bk-page-header", "bk-page-header_detail", className)} data-variant="detail">
      <div className={cx("bk-page-header_row", "bk-page-header_row_detail")}>
        {icon ? <div className="bk-page-header_detail_icon">{icon}</div> : null}
        <div className="bk-page-header_body">
          <h1 className={cx("bk-page-header_title", "bk-page-header_title_detail", titleClassName)}>{title}</h1>
          {subtitle ? <p className="bk-page-header_subtitle">{subtitle}</p> : null}
          {highlights ? <div className="bk-page-header_detail_highlights">{highlights}</div> : null}
        </div>
        {actions ? <div className="bk-page-header_actions">{actions}</div> : null}
      </div>
    </header>
  );
}
