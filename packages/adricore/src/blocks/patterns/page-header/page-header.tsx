import * as React from "react";
import { PageHeaderDetail } from "./page-header-detail";
import { PageHeaderList } from "./page-header-list";
import type { PageHeaderProps } from "./types";

/**
 * Public entry. Routes to the variant-specific implementation based on `variant`.
 *
 * - `detail` (default) — Salesforce record page header.
 * - `list`             — Lightning list-view header.
 */
export function PageHeader(props: PageHeaderProps) {
  const variant = props.variant ?? "detail";
  if (variant === "list") return <PageHeaderList {...props} />;
  return <PageHeaderDetail {...props} />;
}
