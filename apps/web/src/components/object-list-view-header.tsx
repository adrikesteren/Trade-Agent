import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";
import type { ReactNode } from "react";

export type ObjectListViewHeaderProps = {
  eyebrow: string;
  title: string;
  rowCount: number;
  sortLine: string;
  /** When true, summary omits the “Max N rows” segment (unbounded list). */
  uncapped?: boolean;
  maxRows?: number;
  /** Overrides default tile (first letter of `title`). */
  icon?: ReactNode;
  /** Single letter when you do not pass a custom `icon`. */
  iconLetter?: string;
  actions?: ReactNode;
};

export function ObjectListViewHeader({
  eyebrow,
  title,
  rowCount,
  sortLine,
  uncapped = false,
  maxRows = 200,
  icon,
  iconLetter,
  actions,
}: ObjectListViewHeaderProps) {
  const n = rowCount;
  const summaryParts = [`${n} row${n === 1 ? "" : "s"}`, sortLine];
  if (!uncapped) summaryParts.push(`Max ${maxRows} rows`);
  const summary = summaryParts.join(" · ");
  const resolvedIcon =
    icon ??
    (iconLetter ? (
      <ListViewObjectIcon letter={iconLetter} />
    ) : (
      <ListViewObjectIcon letter={title.trim().slice(0, 1).toUpperCase()} />
    ));

  return (
    <PageHeader
      variant="list"
      icon={resolvedIcon}
      eyebrow={eyebrow}
      title={title}
      titleAddon={<ListViewTitlePickerPlaceholder />}
      summary={summary}
      toolbar={<ListViewPlaceholderToolbar />}
      actions={
        actions ?? (
          <Link href="/overview" className={listViewOutlineActionClass}>
            Overview
          </Link>
        )
      }
    />
  );
}
