import * as React from "react";
import { cx } from "../../lib/cx";

export type Crumb = { label: string; href?: string };

export type BreadcrumbsProps = {
  items: Crumb[];
  className?: string;
};

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={cx("bk-breadcrumb", className)}>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`}>
            {i > 0 ? (
              <span className="bk-breadcrumb-sep" aria-hidden>
                /
              </span>
            ) : null}
            {item.href ? (
              <a href={item.href} className="bk-breadcrumb-link">
                {item.label}
              </a>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
