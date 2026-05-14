import * as React from "react";
import { cx } from "../../lib/cx";

export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("bk-table-wrap", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx("bk-table", className)} {...props} />;
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={className} {...props} />;
}

export function Td({
  className,
  muted,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { muted?: boolean }) {
  return <td className={cx(muted && "bk-table-muted", className)} {...props} />;
}
