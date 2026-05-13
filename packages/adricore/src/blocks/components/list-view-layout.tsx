import * as React from "react";
import { cx } from "../lib/cx";

export type ListViewLayoutProps = React.HTMLAttributes<HTMLDivElement>;

/** List / object-manager shell: soft page background (pairs with list `PageHeader` variant). */
export function ListViewLayout({ className, ...props }: ListViewLayoutProps) {
  return <div className={cx("adri-list-view-layout", className)} {...props} />;
}
