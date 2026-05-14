import * as React from "react";
import { cx } from "../../lib/cx";

export type StackProps = React.HTMLAttributes<HTMLDivElement> & {
  gap?: "sm" | "md" | "lg";
};

const gapClass = {
  sm: "bk-stack_gap-sm",
  md: "bk-stack_gap-md",
  lg: "bk-stack_gap-lg",
} as const;

/** Vertical flex stack with predefined gap sizes. Styling lives in `styles/base.css`. */
export function Stack({ gap = "md", className, ...props }: StackProps) {
  return <div className={cx("bk-stack", gapClass[gap], className)} {...props} />;
}
