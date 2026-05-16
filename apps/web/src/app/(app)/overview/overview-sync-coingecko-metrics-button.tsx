"use client";

import { syncCoingeckoMetricsFromOverview } from "@/app/(app)/overview/actions";
import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

export function OverviewSyncCoingeckoMetricsButton() {
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
            const r = await syncCoingeckoMetricsFromOverview();
            if (r.ok) {
              const bits = [
                `${r.assetsUpdated} assets updated`,
                `${r.fiatDollarValuesUpdated} fiat dollar_value rows`,
                `${r.assetsConsidered} considered`,
                `${r.stillMissingCoingeckoId} skipped (no coin id)`,
              ];
              if (r.searchFailureCount > 0) bits.push(`${r.searchFailureCount} resolve errors`);
              setFeedback({
                tone: "success",
                text: `CoinGecko metrics: ${bits.join(" Â· ")}.`,
              });
            } else {
              setFeedback({ tone: "error", text: r.error });
            }
          });
        }}
      >
        {pending ? "Syncingâ€¦" : "Sync Coingecko With Assets"}
      </Button>
    </div>
  );
}
