"use client";

import { syncCoingeckoCoinIdsFromOverview } from "@/app/(app)/overview/actions";
import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

export function OverviewSyncCoingeckoCoinIdsButton() {
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex max-w-[min(100%,32rem)] flex-col gap-2">
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
            const r = await syncCoingeckoCoinIdsFromOverview();
            if (r.ok) {
              if (r.via === "relay") {
                const gid = r.relayMessageGroupIds?.[0];
                const tail = gid
                  ? `message-group ${gid.slice(0, 8)}â€¦ Â· ${r.published} job(s).`
                  : `${r.published} job(s) Â· ${r.relayMessageIds.length} message id(s).`;
                setFeedback({
                  tone: "success",
                  text: `CoinGecko coin id discovery queued on Relay (${tail}). Ensure Relay dispatch is running.`,
                });
              } else {
                const bits = [
                  `${r.copiedFromMetadata} from metadata`,
                  `${r.filledViaSearch} via CoinGecko search (${r.searchAttempts} attempts)`,
                  `${r.stillMissingCoinId} still without id`,
                ];
                if (r.tasksCreated > 0) bits.push(`${r.tasksCreated} manual task(s) created`);
                if (r.failureCount > 0) bits.push(`${r.failureCount} row errors`);
                setFeedback({
                  tone: "success",
                  text: `CoinGecko coin id: ${bits.join(" Â· ")}.`,
                });
              }
            } else {
              setFeedback({ tone: "error", text: r.error });
            }
          });
        }}
      >
        {pending ? "Syncingâ€¦" : "Sync Assets With Coingecko Id"}
      </Button>
    </div>
  );
}
