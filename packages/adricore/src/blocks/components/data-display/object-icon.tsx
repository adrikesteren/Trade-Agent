import * as React from "react";
import { cx } from "../../lib/cx";

export type ListViewObjectIconProps = {
  /** Single letter / short glyph rendered when no `children` are passed. */
  letter?: string;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Lightning-style object icon: rounded gradient square with a centered letter or custom glyph.
 * Re-used in list view headers and record page headers.
 */
export function ListViewObjectIcon({ letter, children, className }: ListViewObjectIconProps) {
  return (
    <div className={cx("bk-object-icon", className)} aria-hidden>
      {children ?? (letter ? <span className="bk-object-icon_letter">{letter}</span> : null)}
    </div>
  );
}
