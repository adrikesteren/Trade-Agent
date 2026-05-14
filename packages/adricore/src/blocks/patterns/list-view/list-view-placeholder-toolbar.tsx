import { Filter, LayoutGrid, Pencil, PieChart, RefreshCw, Settings } from "lucide-react";
import { ListViewIconButton } from "./list-view-icon-button";
import { ListViewSearch } from "./list-view-search";
import { ListViewToolbar } from "./list-view-toolbar";

/**
 * Read-only toolbar matching common Lightning list controls (search + icon row).
 * Inert placeholders — wire up real behaviour on a per-list basis when needed.
 */
export function ListViewPlaceholderToolbar() {
  return (
    <ListViewToolbar
      leading={
        <ListViewSearch placeholder="Search this list…" disabled aria-label="Search this list" name="_listSearch" />
      }
      trailing={
        <>
          <ListViewIconButton label="List settings" disabled>
            <Settings size={15} strokeWidth={2} />
          </ListViewIconButton>
          <ListViewIconButton label="Display density" disabled>
            <LayoutGrid size={15} strokeWidth={2} />
          </ListViewIconButton>
          <ListViewIconButton label="Refresh" disabled>
            <RefreshCw size={15} strokeWidth={2} />
          </ListViewIconButton>
          <ListViewIconButton label="Inline edit" disabled>
            <Pencil size={15} strokeWidth={2} />
          </ListViewIconButton>
          <ListViewIconButton label="Charts" disabled>
            <PieChart size={15} strokeWidth={2} />
          </ListViewIconButton>
          <ListViewIconButton label="Filters" disabled>
            <Filter size={15} strokeWidth={2} />
          </ListViewIconButton>
        </>
      }
    />
  );
}
