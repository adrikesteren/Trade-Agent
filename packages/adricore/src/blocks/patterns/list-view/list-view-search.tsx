import * as React from "react";
import { Search } from "lucide-react";
import { cx } from "../../lib/cx";

export type ListViewSearchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Defaults to `search`. */
  type?: React.HTMLInputTypeAttribute;
};

export const ListViewSearch = React.forwardRef<HTMLInputElement, ListViewSearchProps>(function ListViewSearch(
  { className, type = "search", ...props },
  ref,
) {
  return (
    <div className={cx("bk-listview-search", className)}>
      <Search className="bk-listview-search_glyph" size={14} strokeWidth={2} aria-hidden />
      <input ref={ref} type={type} className="bk-listview-search_input" {...props} />
    </div>
  );
});
