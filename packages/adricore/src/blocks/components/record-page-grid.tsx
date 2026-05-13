import * as React from "react";
import { cx } from "../lib/cx";

export type RecordPageGridProps = {
  children: React.ReactNode;
  className?: string;
};

export function RecordPageGrid({ children, className }: RecordPageGridProps) {
  return <div className={cx("adri-record-page-grid", className)}>{children}</div>;
}
