"use client";

import { enqueueMarketSymbolCloseRelay } from "@/app/(app)/markets/[id]/actions";
import { Alert, Button } from "@repo/adricore/blocks";
import { useState, useTransition } from "react";

type Props = {
  marketId: string;
};

export function MarketHeaderSyncButton({ marketId }: Props) {
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex max-w-[min(100%,20rem)] flex-col items-end gap-2">
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
            const r = await enqueueMarketSymbolCloseRelay(marketId);
            if (r.ok) {
              setFeedback({
                tone: "success",
                text: `Relay message queued (${r.relayMessageId}). Ensure Relay dispatch is running.`,
              });
            } else {
              setFeedback({ tone: "error", text: r.error });
            }
          });
        }}
      >
        {pending ? "Sync…" : "Sync"}
      </Button>
    </div>
  );
}
