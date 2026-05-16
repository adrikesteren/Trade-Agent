"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@adrikesteren/adricore/blocks";
import * as React from "react";

export type RecordPageTabsProps = {
  details: React.ReactNode;
  /** When omitted or `null`, only the Details column is shown (no Related tab). */
  related?: React.ReactNode | null;
  /** Initial tab when `related` is present. Defaults to `related` for backward compatibility. */
  defaultTab?: "details" | "related";
};

/** Salesforce-style Details / Related tabs for record pages (used inside `DetailPageLayout` `content`). */
export function RecordPageTabs({ details, related, defaultTab = "related" }: RecordPageTabsProps) {
  if (related == null) {
    return <div className="bk-stack bk-stack_gap-md w-full min-w-0">{details}</div>;
  }

  return (
    <Tabs defaultValue={defaultTab} className="w-full min-w-0">
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="related">Related</TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="bk-stack bk-stack_gap-md mt-3 outline-none">
        {details}
      </TabsContent>
      <TabsContent value="related" className="bk-stack bk-stack_gap-md mt-3 outline-none">
        {related}
      </TabsContent>
    </Tabs>
  );
}
