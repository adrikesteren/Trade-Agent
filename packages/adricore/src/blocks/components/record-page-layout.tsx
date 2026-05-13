import * as React from "react";
import { cx } from "../lib/cx";
import { Card, CardBody } from "./card";

export type RecordPageLayoutProps = React.HTMLAttributes<HTMLDivElement>;

/** Page chrome: soft page background (Salesforce record shell). */
export function RecordPageLayout({ className, ...props }: RecordPageLayoutProps) {
  return <div className={cx("adri-record-detail-layout", className)} {...props} />;
}

export type RecordPageCardProps = {
  children: React.ReactNode;
  className?: string;
};

/** Primary white record card (sections + grids go inside). */
export function RecordPageCard({ children, className }: RecordPageCardProps) {
  return (
    <Card className={cx("adri-record-detail-card", className)}>
      <CardBody className="adri-record-detail-card_body">{children}</CardBody>
    </Card>
  );
}
