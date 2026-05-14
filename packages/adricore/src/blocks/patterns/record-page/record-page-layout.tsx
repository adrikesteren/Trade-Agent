import * as React from "react";
import { cx } from "../../lib/cx";

export type RecordPageLayoutProps = React.HTMLAttributes<HTMLDivElement>;

/** Soft page background that frames a record's header + content + sidebar. */
export function RecordPageLayout({ className, ...props }: RecordPageLayoutProps) {
  return <div className={cx("bk-record-page-layout", className)} {...props} />;
}
