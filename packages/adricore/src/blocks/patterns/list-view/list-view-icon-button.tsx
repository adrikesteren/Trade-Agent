import * as React from "react";
import { cx } from "../../lib/cx";

export type ListViewIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required for both `aria-label` and the native tooltip. */
  label: string;
};

/** Square icon button used in the list-view toolbar trailing area. */
export const ListViewIconButton = React.forwardRef<HTMLButtonElement, ListViewIconButtonProps>(
  function ListViewIconButton({ label, className, type = "button", children, ...props }, ref) {
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
  },
);
