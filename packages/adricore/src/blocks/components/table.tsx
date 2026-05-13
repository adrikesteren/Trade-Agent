import * as React from "react";
import { cx } from "../lib/cx";

export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("adri-table-wrap", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx("adri-table", className)} {...props} />;
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={className} {...props} />;
}

export function Td({ className, muted, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { muted?: boolean }) {
  return <td className={cx(muted && "adri-table-muted", className)} {...props} />;
}
