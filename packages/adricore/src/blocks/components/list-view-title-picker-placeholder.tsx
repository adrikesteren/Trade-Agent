import { ChevronDown, Pin } from "lucide-react";

/** Disabled list-view name + chevron + pin (Lightning-style); wire a real menu later. */
export function ListViewTitlePickerPlaceholder() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button type="button" className="adri-listview-picker-btn" disabled aria-label="Change list view">
        <ChevronDown size={18} strokeWidth={2.25} />
      </button>
      <Pin size={14} strokeWidth={2} className="opacity-60" aria-hidden />
    </span>
  );
}
