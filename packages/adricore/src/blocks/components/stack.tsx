import * as React from "react";
import { cx } from "../lib/cx";

export type StackProps = React.HTMLAttributes<HTMLDivElement> & {
  gap?: "sm" | "md" | "lg";
};

const gapClass = {
  sm: "adri-stack_gap-sm",
  md: "adri-stack_gap-md",
  lg: "adri-stack_gap-lg",
} as const;

export function Stack({ gap = "md", className, ...props }: StackProps) {
  return <div className={cx("adri-stack", gapClass[gap], className)} {...props} />;
}
