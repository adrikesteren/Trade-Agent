"use client";

import { retrieveBitvavoMarketsLinkedToAssets } from "@/app/(app)/overview/actions";
import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

const DEFAULT_LABEL = "Retrieve Markets from Bitvavo";

type Props = {
  /** Idle button label (default: full wording for /overview). */
  label?: string;
};

export function OverviewRetrieveBitvavoMarketsButton({ label = DEFAULT_LABEL }: Props) {
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
        variant="neutral"
        size="sm"
        disabled={pending}
        onClick={() => {
          setFeedback(null);
          startTransition(async () => {
            const r = await retrieveBitvavoMarketsLinkedToAssets();
            if (r.ok) {
              setFeedback({
                tone: "success",
                text: `Bitvavo: ${r.fetchedFromApi} markets from API (${r.tradingMarkets} trading). Upserted ${r.marketsUpserted} rows linked to catalog assets; skipped ${r.skippedMissingAsset} (no matching base asset), ${r.skippedMissingQuote} (no matching quote asset).`,
              });
            } else {
              setFeedback({ tone: "error", text: r.error });
            }
          });
        }}
      >
        {pending ? "Retrievingâ€¦" : label}
      </Button>
    </div>
  );
}
