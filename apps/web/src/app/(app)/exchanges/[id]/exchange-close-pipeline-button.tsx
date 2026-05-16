"use client";

import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

type Props = {
  exchangeId: string;
};

type ApiResponse =
  | {
      ok: true;
      queued: boolean;
      groupId?: string;
      chunkCount?: number;
      messageIds?: string[];
    }
  | { ok: false; error: string };

/**
 * Header action: enqueues a Relay message-group that runs the
 * `close-candle-pipeline` orchestrator for every live market on this exchange
 * (default EUR quote). Posts to `/api/v1/exchanges/close-candle-pipeline/{id}`.
 */
export function ExchangeClosePipelineButton({ exchangeId }: Props) {
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
        variant="brand"
        size="sm"
        title="Enqueue the close-candle pipeline for every live market on this exchange (default quote EUR)."
        disabled={pending}
        onClick={() => {
          setFeedback(null);
          startTransition(async () => {
            try {
              const res = await fetch(
                `/api/v1/exchanges/close-candle-pipeline/${encodeURIComponent(exchangeId)}`,
                { method: "POST" },
              );
              const body = (await res.json()) as ApiResponse & { error?: string };
              if (!res.ok || body.ok === false) {
                setFeedback({ tone: "error", text: body?.error ?? res.statusText });
                return;
              }
              if (body.queued && body.groupId) {
                const gid = body.groupId.slice(0, 8) + "…";
                setFeedback({
                  tone: "success",
                  text: `Queued ${body.chunkCount ?? 0} chunk(s) as Relay group ${gid}.`,
                });
              } else {
                setFeedback({
                  tone: "success",
                  text: "Nothing to enqueue (no live markets for this exchange + quote).",
                });
              }
            } catch (e) {
              setFeedback({ tone: "error", text: e instanceof Error ? e.message : String(e) });
            }
          });
        }}
      >
        {pending ? "Running pipeline…" : "Run close pipeline"}
      </Button>
    </div>
  );
}
