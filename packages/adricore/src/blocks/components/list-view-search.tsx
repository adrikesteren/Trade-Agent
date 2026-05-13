import * as React from "react";
import { Search } from "lucide-react";
import { cx } from "../lib/cx";

export type ListViewSearchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Defaults to `search`. */
  type?: React.HTMLInputTypeAttribute;
};

export const ListViewSearch = React.forwardRef<HTMLInputElement, ListViewSearchProps>(function ListViewSearch(
  { className, type = "search", ...props },
  ref,
) {
  return (
    <div className={cx("adri-listview-search", className)}>
      <Search className="adri-listview-search_glyph" size={16} strokeWidth={2} aria-hidden />
      <input ref={ref} type={type} className="adri-listview-search_input" {...props} />
    </div>
  );
});
