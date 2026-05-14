import * as React from "react";
import { cx } from "../../lib/cx";

export type SpinnerProps = {
  className?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

export function Spinner({ className, "aria-label": ariaLabel = "Loading", "aria-hidden": ariaHidden }: SpinnerProps) {
  const role = ariaHidden ? undefined : "status";
  return (
    <span
      className={cx("bk-spinner", className)}
      role={role}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden}
    />
  );
}
