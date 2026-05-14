import * as React from "react";
import { cx } from "../../lib/cx";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "error";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: "bk-badge_neutral",
  brand: "bk-badge_brand",
  success: "bk-badge_success",
  warning: "bk-badge_warning",
  error: "bk-badge_error",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={cx("bk-badge", toneClass[tone], className)} {...props} />;
}
