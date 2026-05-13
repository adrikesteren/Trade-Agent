import * as React from "react";
import { cx } from "../lib/cx";

export type RecordPageSectionProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function RecordPageSection({ title, description, children, className }: RecordPageSectionProps) {
  return (
    <section className={cx("adri-record-page-section", className)}>
      <header className="adri-record-page-section_header">
        <h2 className="adri-record-page-section_title">{title}</h2>
        {description ? <div className="adri-record-page-section_desc">{description}</div> : null}
      </header>
      <div className="adri-record-page-section_body">{children}</div>
    </section>
  );
}
