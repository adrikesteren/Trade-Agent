"use client";

import { useState } from "react";

import { Button } from "@adrikesteren/adricore/blocks";

/** Header action: POST historical replay (paper). Feedback stays inline under the button. */
export function ExecutorHistoricalRunHeaderAction(props: { executorId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex max-w-[14rem] flex-col items-end gap-1">
      <Button
        type="button"
        variant="brand"
        size="sm"
        title="Ingest 15m candles for the configured UTC range, then replay signal → mediator → executor per bar (paper)."
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setMessage(null);
          try {
            const res = await fetch(`/api/executors/${encodeURIComponent(props.executorId)}/historical-run`, {
              method: "POST",
            });
            const body = (await res.json()) as {
              ok?: boolean;
              queued?: boolean;
              relayMessageId?: string;
              error?: string;
              barsReplayed?: number;
              candleRowsUpserted?: number;
            };
            if (!res.ok) {
              setError(body?.error ?? res.statusText);
              return;
            }
            if (body.queued && body.relayMessageId) {
              setMessage(`Queued on Relay (message ${body.relayMessageId}). Replay runs in the background.`);
              return;
            }
            setMessage(
              `Done: ${body.barsReplayed ?? 0} bars, ${body.candleRowsUpserted ?? 0} candle rows upserted.`,
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Running…" : "Run"}
      </Button>
      {error ? (
        <p className="text-right text-[0.6875rem] leading-snug text-red-600 dark:text-red-400" role="status">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-right text-[0.6875rem] leading-snug text-emerald-700 dark:text-emerald-400" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
