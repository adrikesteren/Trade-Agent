import * as React from "react";
import { cx } from "../lib/cx";

export type AlertTone = "info" | "success" | "warning" | "error";

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: AlertTone;
};

const toneClass: Record<AlertTone, string> = {
  info: "adri-alert_info",
  success: "adri-alert_success",
  warning: "adri-alert_warning",
  error: "adri-alert_error",
};

export function Alert({ className, tone = "info", role = "status", ...props }: AlertProps) {
  return <div role={role} className={cx("adri-alert", toneClass[tone], className)} {...props} />;
}
