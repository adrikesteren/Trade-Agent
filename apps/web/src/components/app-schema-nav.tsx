"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  menuTriggerPlainClass,
} from "@repo/adricore/blocks";
import { getTabHref } from "@repo/adricore/platform";
import type { TabMetadata } from "@/models/types";
import Link from "next/link";

type NavBlock =
  | { kind: "link"; tab: TabMetadata }
  | { kind: "dropdown"; section: string; tabs: TabMetadata[] };

function buildNavBlocks(tabs: TabMetadata[]): NavBlock[] {
  const sorted = [...tabs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const blocks: NavBlock[] = [];
  for (const tab of sorted) {
    if (tab.section) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "dropdown" && last.section === tab.section) {
        last.tabs.push(tab);
      } else {
        blocks.push({ kind: "dropdown", section: tab.section, tabs: [tab] });
      }
    } else {
      blocks.push({ kind: "link", tab });
    }
  }
  return blocks;
}

export type AppSchemaNavProps = {
  tabs: TabMetadata[];
};

export function AppSchemaNav({ tabs }: AppSchemaNavProps) {
  const blocks = buildNavBlocks(tabs);

  return (
    <nav className="flex flex-wrap items-center gap-3 text-xs">
      {blocks.map((block, i) => {
        if (block.kind === "link") {
          const href = getTabHref(block.tab);
          return (
            <Link key={`${block.tab.slug}-${i}`} href={href} className={menuTriggerPlainClass}>
              {block.tab.label}
            </Link>
          );
        }
        return (
          <DropdownMenu key={`${block.section}-${i}`}>
            <DropdownMenuTrigger className={menuTriggerPlainClass}>{block.section}</DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {block.tabs.map((tab) => (
                <DropdownMenuItem key={tab.slug} asChild>
                  <Link href={getTabHref(tab)}>{tab.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
