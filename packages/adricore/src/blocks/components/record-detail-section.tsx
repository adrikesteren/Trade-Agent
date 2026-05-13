import * as React from "react";
import { cx } from "../lib/cx";

export type RecordDetailSectionProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function RecordDetailSection({ title, description, children, className }: RecordDetailSectionProps) {
  return (
    <section className={cx("bk-record-detail-section", className)}>
      <header className="bk-record-detail-section_header">
        <h2 className="bk-record-detail-section_title">{title}</h2>
        {description ? <div className="bk-record-detail-section_desc">{description}</div> : null}
      </header>
      <div className="bk-record-detail-section_body">{children}</div>
    </section>
  );
}
