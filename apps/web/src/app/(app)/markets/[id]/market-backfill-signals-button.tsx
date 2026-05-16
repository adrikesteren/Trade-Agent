"use client";

import { enqueueMarketBackfillSignalsViaRelay } from "@/app/(app)/markets/[id]/actions";
import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

type Props = {
  marketId: string;
};

/**
 * Header action: walks every stored candle for this market and only generates `trading.signals` rows
 * for agents that have not yet produced a signal for that bar. Queues the work as a chunked Relay
 * `message-group` (5 days per chunk) when Relay is configured; otherwise runs once inline.
 */
export function MarketBackfillSignalsButton({ marketId }: Props) {
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex max-w-[min(100%,22rem)] flex-col items-end gap-2">
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
            const r = await enqueueMarketBackfillSignalsViaRelay(marketId);
            if (!r.ok) {
              setFeedback({ tone: "error", text: r.error });
              return;
            }
            if (r.queued) {
              const gid = r.groupId ? r.groupId.slice(0, 8) + "…" : "—";
              setFeedback({
                tone: "success",
                text: `Queued ${r.chunkCount} chunk(s) (${r.startDate} → ${r.endDate}) as Relay group ${gid}.`,
              });
            } else {
              setFeedback({
                tone: "success",
                text: `Inline: inspected ${r.barsInspected ?? 0} bars (${r.barsFilled ?? 0} filled, ${r.signalsUpsertedTotal ?? 0} signals upserted).`,
              });
            }
          });
        }}
      >
        {pending ? "Backfill signals…" : "Backfill signals"}
      </Button>
    </div>
  );
}
