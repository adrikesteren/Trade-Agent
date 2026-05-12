"use client";

import { retrieveBitvavoCatalogAssets } from "@/app/(app)/overview/actions";
import { Alert, Button } from "@repo/blocks";
import { useState, useTransition } from "react";

const DEFAULT_LABEL = "Retrieve Assets from Bitvavo";

type Props = {
  /** Idle button label (default: full Bitvavo wording for /overview). */
  label?: string;
};

export function OverviewRetrieveBitvavoAssetsButton({ label = DEFAULT_LABEL }: Props) {
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex max-w-[min(100%,28rem)] flex-col gap-2">
      {feedback ? (
        <Alert tone={feedback.tone} className="text-left text-xs">
          {feedback.text}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="brand"
        size="sm"
        disabled={pending}
        onClick={() => {
          setFeedback(null);
          startTransition(async () => {
            const r = await retrieveBitvavoCatalogAssets();
            if (r.ok) {
              setFeedback({
                tone: "success",
                text: `Bitvavo: ${r.fetchedFromApi} assets from API. Upserted ${r.assetsUpserted} (${r.inserted} new, ${r.updated} updated).`,
              });
            } else {
              setFeedback({ tone: "error", text: r.error });
            }
          });
        }}
      >
        {pending ? "Retrieving…" : label}
      </Button>
    </div>
  );
}
