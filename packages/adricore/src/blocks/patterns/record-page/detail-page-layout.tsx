import * as React from "react";
import { cx } from "../../lib/cx";
import { RecordPageLayout, type RecordPageLayoutProps } from "./record-page-layout";

export type DetailPageLayoutProps = Omit<RecordPageLayoutProps, "children" | "content"> & {
  header: React.ReactNode;
  content: React.ReactNode;
  /** Right column (40% from 48rem up). Omit or pass `null` for an empty aside. */
  sidebar?: React.ReactNode | null;
};

/**
 * Detail page shell: full-width header, then `main` + `aside` row.
 * Aside takes 40% from `md` and stacks below `main` on narrower screens.
 * An empty aside is hidden on small viewports to avoid a blank strip.
 */
export function DetailPageLayout({ header, content, sidebar, className, ...rest }: DetailPageLayoutProps) {
  const hasSidebarContent = sidebar != null;

  return (
    <RecordPageLayout className={cx(className)} {...rest}>
      <div className="bk-detail-page-layout_inner bk-stack bk-stack_gap-md">
        <div className="bk-detail-page-layout_header">{header}</div>
        <div className="bk-detail-page-layout_row">
          <div className="bk-detail-page-layout_main">{content}</div>
          <aside
            className={cx(
              "bk-detail-page-layout_aside",
              !hasSidebarContent && "bk-detail-page-layout_aside_empty",
            )}
          >
            {hasSidebarContent ? sidebar : null}
          </aside>
        </div>
      </div>
    </RecordPageLayout>
  );
}
