import * as React from "react";
import { cx } from "../lib/cx";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "error";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: "adri-badge_neutral",
  brand: "adri-badge_brand",
  success: "adri-badge_success",
  warning: "adri-badge_warning",
  error: "adri-badge_error",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={cx("adri-badge", toneClass[tone], className)} {...props} />;
}
