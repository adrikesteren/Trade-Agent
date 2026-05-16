"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  menuTriggerPlainClass,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";

export type TabInfo = {
  slug: string;
  label: string;
  href: string;
  target?: string;
  section?: string;
  order?: number;
};

type NavBlock =
  | { kind: "link"; tab: TabInfo }
  | { kind: "dropdown"; section: string; tabs: TabInfo[] };

function buildNavBlocks(tabs: TabInfo[]): NavBlock[] {
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
  tabs: TabInfo[];
};

export function AppSchemaNav({ tabs }: AppSchemaNavProps) {
  const blocks = buildNavBlocks(tabs);

  return (
    <nav className="flex flex-wrap items-center gap-3 text-xs">
      {blocks.map((block, i) => {
        if (block.kind === "link") {
          return (
              <Link key={`${block.tab.slug}-${i}`} href={block.tab.href} className={menuTriggerPlainClass} target={block.tab.target}>
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
                  <Link href={tab.href} target={tab.target}>{tab.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
