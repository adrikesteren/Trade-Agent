import * as React from "react";
import { cx } from "../lib/cx";

export type PageHeaderVariant = "default" | "detail" | "list";

export type PageHeaderProps = {
  title: React.ReactNode;
  /** Uppercase / small label above the title (object name, e.g. “Markets”). */
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Small monospace / technical line (e.g. UUID) under the subtitle. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** e.g. `<Breadcrumbs items={…} />` */
  breadcrumb?: React.ReactNode;
  /** Plain anchor; use for “back to list”. Prefer `breadcrumb` when you use Next `<Link>`. */
  back?: { href: string; label: string };
  /**
   * `default` — standard page title.
   * `detail` — record page: strong title, bottom rule, optional breadcrumb/back/meta.
   * `list` — Lightning list view: object icon, title row, primary actions, summary strip, toolbar row.
   */
  variant?: PageHeaderVariant;
  /** Lightning-style object icon (letter or custom node). */
  icon?: React.ReactNode;
  /** Title row suffix (e.g. list view picker chevron). */
  titleAddon?: React.ReactNode;
  /** Metadata row under the title block (“50+ items • Sorted by …”). */
  summary?: React.ReactNode;
  /** Bottom row: typically `ListViewToolbar` with search + icon buttons. */
  toolbar?: React.ReactNode;
  /** Record page: key fields under the title (e.g. `Output` row). Detail variant only. */
  highlights?: React.ReactNode;
  /** Extra classes on the `<h1>`. */
  titleClassName?: string;
  className?: string;
};

function PageHeaderList({
  title,
  eyebrow,
  subtitle,
  meta,
  actions,
  breadcrumb,
  back,
  icon,
  titleAddon,
  summary,
  toolbar,
  titleClassName,
  className,
}: Omit<PageHeaderProps, "variant">) {
  const showTop = Boolean(breadcrumb || back);
  const topRowEnd = Boolean(back && !breadcrumb);

  return (
    <header className={cx("adri-page-header", "adri-listview", className)} data-variant="list">
      {showTop ? (
        <div className="adri-page-header_top adri-listview-breadcrumb-wrap">
          <div className={cx("adri-page-header_top_row", topRowEnd && "adri-page-header_top_row_end")}>
            {breadcrumb ? <div className="adri-page-header_breadcrumb">{breadcrumb}</div> : null}
            {back ? (
              <a href={back.href} className={cx("adri-link", "adri-page-header_back")}>
                {back.label}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="adri-listview-main">
        {icon ? <div className="adri-listview-main_icon">{icon}</div> : null}
        <div className={cx("adri-listview-main_text", !icon && "adri-listview-main_text_full")}>
          {eyebrow ? <div className="adri-listview-eyebrow">{eyebrow}</div> : null}
          <div className="adri-listview-title-row">
            <h1 className={cx("adri-listview-title", titleClassName)}>{title}</h1>
            {titleAddon ? <span className="adri-listview-title-addon">{titleAddon}</span> : null}
          </div>
          {subtitle ? <div className="adri-listview-description">{subtitle}</div> : null}
          {meta ? <p className="adri-page-header_meta adri-listview-meta">{meta}</p> : null}
        </div>
        {actions ? <div className="adri-listview-primary-actions">{actions}</div> : null}
      </div>

      {summary ? <div className="adri-listview-summary">{summary}</div> : null}
      {toolbar ? <div className="adri-listview-toolbar-host">{toolbar}</div> : null}
    </header>
  );
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  meta,
  actions,
  breadcrumb,
  back,
  variant = "default",
  icon,
  titleAddon,
  summary,
  toolbar,
  highlights,
  titleClassName,
  className,
}: PageHeaderProps) {
  const isDetail = variant === "detail";
  const isList = variant === "list";
  const showTop = Boolean(breadcrumb || back);
  const topRowEnd = Boolean(back && !breadcrumb);

  if (isList) {
    return (
      <PageHeaderList
        title={title}
        eyebrow={eyebrow}
        subtitle={subtitle}
        meta={meta}
        actions={actions}
        breadcrumb={breadcrumb}
        back={back}
        icon={icon}
        titleAddon={titleAddon}
        summary={summary}
        toolbar={toolbar}
        titleClassName={titleClassName}
        className={className}
      />
    );
  }

  return (
    <header
      className={cx("adri-page-header", isDetail && "adri-page-header_detail", className)}
      data-variant={variant}
    >
      {showTop ? (
        <div className="adri-page-header_top">
          <div className={cx("adri-page-header_top_row", topRowEnd && "adri-page-header_top_row_end")}>
            {breadcrumb ? <div className="adri-page-header_breadcrumb">{breadcrumb}</div> : null}
            {back ? (
              <a href={back.href} className={cx("adri-link", "adri-page-header_back")}>
                {back.label}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={cx("adri-page-header_row", Boolean(isDetail && icon) && "adri-page-header_row_detail")}>
        {isDetail && icon ? <div className="adri-page-header_detail_icon">{icon}</div> : null}
        <div className="adri-page-header_body">
          {eyebrow ? <div className="adri-page-header_eyebrow">{eyebrow}</div> : null}
          <h1
            className={cx(
              "adri-page-header_title",
              isDetail && "adri-page-header_title_detail",
              titleClassName,
            )}
          >
            {title}
          </h1>
          {isDetail && highlights ? (
            <div className="adri-page-header_detail_highlights">{highlights}</div>
          ) : null}
          {subtitle ? <p className="adri-page-header_subtitle">{subtitle}</p> : null}
          {meta ? <p className="adri-page-header_meta">{meta}</p> : null}
        </div>
        {actions ? <div className="adri-page-header_actions">{actions}</div> : null}
      </div>
    </header>
  );
}
