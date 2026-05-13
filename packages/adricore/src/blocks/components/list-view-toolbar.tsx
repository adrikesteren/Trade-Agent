import * as React from "react";
import { cx } from "../lib/cx";

export type ListViewToolbarProps = {
  /** Typically a `ListViewSearch`. */
  leading?: React.ReactNode;
  /** Icon buttons / secondary controls (right side). */
  trailing?: React.ReactNode;
  className?: string;
};

export function ListViewToolbar({ leading, trailing, className }: ListViewToolbarProps) {
  return (
    <div className={cx("bk-listview-toolbar", className)}>
      <div className="bk-listview-toolbar_leading">{leading}</div>
      <div className="bk-listview-toolbar_trailing">{trailing}</div>
    </div>
  );
}
