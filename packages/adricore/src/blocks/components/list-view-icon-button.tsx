import * as React from "react";
import { cx } from "../lib/cx";

export type ListViewIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export const ListViewIconButton = React.forwardRef<HTMLButtonElement, ListViewIconButtonProps>(function ListViewIconButton(
  { label, className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("bk-listview-icon-btn", className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
});
