import * as React from "react";
import { cx } from "../../lib/cx";

export type RecordPageGridProps = {
  children: React.ReactNode;
  className?: string;
};

/** Two-column grid of `<Output>` fields (single column on small screens). */
export function RecordPageGrid({ children, className }: RecordPageGridProps) {
  return <div className={cx("bk-record-page-grid", className)}>{children}</div>;
}
