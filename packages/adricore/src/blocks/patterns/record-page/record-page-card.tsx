import * as React from "react";
import { cx } from "../../lib/cx";
import { Card, CardBody } from "../../components/layout/card";

export type RecordPageCardProps = {
  children: React.ReactNode;
  className?: string;
};

/** White card on a record detail page (holds sections + grids). */
export function RecordPageCard({ children, className }: RecordPageCardProps) {
  return (
    <Card className={cx("bk-record-page-card", className)}>
      <CardBody className="bk-record-page-card_body">{children}</CardBody>
    </Card>
  );
}
