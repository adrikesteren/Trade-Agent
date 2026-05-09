import {
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";
import type { ReactNode } from "react";

export type DashboardListViewHeaderProps = {
  eyebrow: string;
  title: string;
  rowCount: number;
  sortLine: string;
  maxRows?: number;
  /** Overrides default tile (first letter of `title`). */
  icon?: ReactNode;
  /** Single letter when you do not pass a custom `icon`. */
  iconLetter?: string;
  actions?: ReactNode;
};

export function DashboardListViewHeader({
  eyebrow,
  title,
  rowCount,
  sortLine,
  maxRows = 200,
  icon,
  iconLetter,
  actions,
}: DashboardListViewHeaderProps) {
  const n = rowCount;
  const summary = [`${n} row${n === 1 ? "" : "s"}`, sortLine, `Max ${maxRows} rows`].join(" · ");
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
          <Link href="/dashboard" className={listViewOutlineActionClass}>
            Dashboard
          </Link>
        )
      }
    />
  );
}
