import * as React from "react";
import { cx } from "../lib/cx";
import { RecordPageLayout, type RecordPageLayoutProps } from "./record-page-layout";

export type DetailPageLayoutProps = Omit<RecordPageLayoutProps, "children" | "content"> & {
  header: React.ReactNode;
  content: React.ReactNode;
  /** Right column (40% from md up). Omit or pass null for an empty aside until you add widgets. */
  sidebar?: React.ReactNode | null;
};

/**
 * Detail page shell: full-width header, then main + aside.
 * From 48rem up the row is **60% / 40%** (`3fr` / `2fr`). Below that width, aside stacks under main;
 * an empty aside is hidden on small screens so you do not get a blank strip.
 */
export function DetailPageLayout({ header, content, sidebar, className, ...rest }: DetailPageLayoutProps) {
  const hasSidebarContent = sidebar != null;

  return (
    <RecordPageLayout className={cx(className)} {...rest}>
      <div className="adri-detail-page-layout_inner adri-stack adri-stack_gap-md">
        <div className="adri-detail-page-layout_header">{header}</div>
        <div className="adri-detail-page-layout_row">
          <div className="adri-detail-page-layout_main">{content}</div>
          <aside
            className={cx("adri-detail-page-layout_aside", !hasSidebarContent && "adri-detail-page-layout_aside_empty")}
          >
            {hasSidebarContent ? sidebar : null}
          </aside>
        </div>
      </div>
    </RecordPageLayout>
  );
}
