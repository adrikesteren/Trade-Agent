import * as React from "react";
import { cx } from "../lib/cx";

export type RecordDetailGridProps = {
  children: React.ReactNode;
  className?: string;
};

export function RecordDetailGrid({ children, className }: RecordDetailGridProps) {
  return <div className={cx("bk-record-detail-grid", className)}>{children}</div>;
}
