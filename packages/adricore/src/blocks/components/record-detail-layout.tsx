import * as React from "react";
import { cx } from "../lib/cx";
import { Card, CardBody } from "./card";

export type RecordDetailLayoutProps = React.HTMLAttributes<HTMLDivElement>;

/** Page chrome: soft page background (Salesforce record shell). */
export function RecordDetailLayout({ className, ...props }: RecordDetailLayoutProps) {
  return <div className={cx("bk-record-detail-layout", className)} {...props} />;
}

export type RecordDetailCardProps = {
  children: React.ReactNode;
  className?: string;
};

/** Primary white record card (sections + grids go inside). */
export function RecordDetailCard({ children, className }: RecordDetailCardProps) {
  return (
    <Card className={cx("bk-record-detail-card", className)}>
      <CardBody className="bk-record-detail-card_body">{children}</CardBody>
    </Card>
  );
}
