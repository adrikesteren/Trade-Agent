import { ChevronDown, Pin } from "lucide-react";

/** Disabled list-view-name + chevron + pin (Lightning-style); wire a real menu later. */
export function ListViewTitlePickerPlaceholder() {
  return (
    <span className="bk-listview-title-picker">
      <button type="button" className="bk-listview-picker-btn" disabled aria-label="Change list view">
        <ChevronDown size={18} strokeWidth={2.25} />
      </button>
      <Pin size={14} strokeWidth={2} className="bk-listview-pin" aria-hidden />
    </span>
  );
}
