import * as React from "react";
import { cx } from "../lib/cx";

export type AlertTone = "info" | "success" | "warning" | "error";

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: AlertTone;
};

const toneClass: Record<AlertTone, string> = {
  info: "bk-alert_info",
  success: "bk-alert_success",
  warning: "bk-alert_warning",
  error: "bk-alert_error",
};

export function Alert({ className, tone = "info", role = "status", ...props }: AlertProps) {
  return <div role={role} className={cx("bk-alert", toneClass[tone], className)} {...props} />;
}
