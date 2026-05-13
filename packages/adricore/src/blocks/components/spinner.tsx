import * as React from "react";
import { cx } from "../lib/cx";

export type SpinnerProps = {
  className?: string;
  "aria-label"?: string;
};

export function Spinner({ className, "aria-label": ariaLabel = "Loading" }: SpinnerProps) {
  return <span className={cx("adri-spinner", className)} role="status" aria-label={ariaLabel} />;
}
