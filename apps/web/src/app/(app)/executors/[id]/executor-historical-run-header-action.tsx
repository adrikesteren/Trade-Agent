"use client";

import { useMemo, useState } from "react";

import { Button } from "@repo/adricore/blocks";

function disabledHint(props: {
  enabled: boolean;
  whitelistBaseWalletBalance: number;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
}): string | null {
  if (!props.enabled) return "Enable the executor before running a replay.";
  if (!Number.isFinite(props.whitelistBaseWalletBalance) || props.whitelistBaseWalletBalance <= 0) {
    return "Add a positive paper balance for the whitelisted base asset (the single filter asset), then refresh.";
  }
  if (!props.historicalStartDate?.trim() || !props.historicalEndDate?.trim()) {
    return "Set historical start and end dates on the executor, then save.";
  }
  return null;
}

/** Header action: POST historical replay (paper). Feedback stays inline under the button. */
export function ExecutorHistoricalRunHeaderAction(props: {
  executorId: string;
  /** Positive `wallet_asset_balance.amount` for the whitelisted base asset (same id as the single filter). */
  whitelistBaseWalletBalance: number;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    props.enabled &&
    Number.isFinite(props.whitelistBaseWalletBalance) &&
    props.whitelistBaseWalletBalance > 0 &&
    Boolean(props.historicalStartDate?.trim()) &&
    Boolean(props.historicalEndDate?.trim());

  const hint = useMemo(() => disabledHint(props), [props]);

  return (
    <div className="flex max-w-[14rem] flex-col items-end gap-1">
      <Button
        type="button"
        variant="brand"
        size="sm"
        title={
          canRun
            ? "Ingest 15m candles for the configured UTC range, then replay signal → mediator → executor per bar (paper)."
            : (hint ?? undefined)
        }
        disabled={!canRun || busy}
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
