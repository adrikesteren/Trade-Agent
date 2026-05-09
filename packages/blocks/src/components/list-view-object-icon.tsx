import * as React from "react";
import { cx } from "../lib/cx";

export type ListViewObjectIconProps = {
  /** Single letter / short glyph when `children` is omitted. */
  letter?: string;
  children?: React.ReactNode;
  className?: string;
};

export function ListViewObjectIcon({ letter, children, className }: ListViewObjectIconProps) {
  return (
    <div className={cx("bk-listview-object-icon", className)} aria-hidden>
      {children ?? (letter ? <span className="bk-listview-object-icon_letter">{letter}</span> : null)}
    </div>
  );
}
