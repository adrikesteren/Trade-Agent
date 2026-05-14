import * as React from "react";
import { cx } from "../../lib/cx";
import type { PageHeaderProps } from "./types";

/**
 * Lightning list-view header: bordered surface with object icon, title row
 * (with picker placeholder addon), summary strip, primary actions, and a
 * toolbar row at the bottom (search + icon controls).
 */
export function PageHeaderList({
  title,
  subtitle,
  actions,
  icon,
  titleAddon,
  summary,
  toolbar,
  titleClassName,
  className,
}: Omit<PageHeaderProps, "variant" | "highlights">) {
  return (
    <header className={cx("bk-page-header", "bk-listview", className)} data-variant="list">
      <div className="bk-listview-main">
        {icon ? <div className="bk-listview-main_icon">{icon}</div> : null}
        <div className={cx("bk-listview-main_text", !icon && "bk-listview-main_text_full")}>
          <div className="bk-listview-title-row">
            <h1 className={cx("bk-listview-title", titleClassName)}>{title}</h1>
            {titleAddon ? <span className="bk-listview-title-addon">{titleAddon}</span> : null}
          </div>
          {subtitle ? <div className="bk-listview-description">{subtitle}</div> : null}
        </div>
        {actions ? <div className="bk-listview-primary-actions">{actions}</div> : null}
      </div>

      {summary ? <div className="bk-listview-summary">{summary}</div> : null}
      {toolbar ? <div className="bk-listview-toolbar-host">{toolbar}</div> : null}
    </header>
  );
}
