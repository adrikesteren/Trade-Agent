"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/blocks";
import * as React from "react";

export type RecordDetailTabsProps = {
  details: React.ReactNode;
  related: React.ReactNode;
  /** Initial tab. Defaults to `related` for backward compatibility. */
  defaultTab?: "details" | "related";
};

/** Salesforce-style Details / Related tabs for record pages (used inside `DetailPageLayout` `content`). */
export function RecordDetailTabs({ details, related, defaultTab = "related" }: RecordDetailTabsProps) {
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
