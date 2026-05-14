import * as React from "react";
import { cx } from "../../lib/cx";

export type ListViewLayoutProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Object manager shell: soft page background that frames the list-variant `PageHeader`
 * plus table / cards underneath.
 */
export function ListViewLayout({ className, ...props }: ListViewLayoutProps) {
  return <div className={cx("bk-list-view-layout", className)} {...props} />;
}
