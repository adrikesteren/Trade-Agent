import * as React from "react";
import { cx } from "../../lib/cx";

export type RecordPageSectionProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** Titled subsection inside a `RecordPageCard` (e.g. "Details"). */
export function RecordPageSection({ title, description, children, className }: RecordPageSectionProps) {
  return (
    <section className={cx("bk-record-page-section", className)}>
      <header className="bk-record-page-section_header">
        <h2 className="bk-record-page-section_title">{title}</h2>
        {description ? <div className="bk-record-page-section_desc">{description}</div> : null}
      </header>
      <div className="bk-record-page-section_body">{children}</div>
    </section>
  );
}
