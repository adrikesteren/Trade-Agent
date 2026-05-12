"use client";

import { useState } from "react";

import { Alert, Button } from "@repo/blocks";

export function ExecutorHistoricalRunPanel(props: {
  executorId: string;
  equityEur: number;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    props.enabled &&
    Number.isFinite(props.equityEur) &&
    props.equityEur > 0 &&
    Boolean(props.historicalStartDate?.trim()) &&
    Boolean(props.historicalEndDate?.trim());

  return (
    <div className="bk-stack bk-stack_gap-sm rounded-lg border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold">Historical replay</h3>
      <p className="bk-text-muted text-xs">
        Ingests 15m candles for the configured UTC date range, then replays signal → mediator → executor for each
        bar (paper). Requires positive EUR balance on this executor.
      </p>
      {!props.enabled ? <Alert tone="warning">Enable the executor before running a replay.</Alert> : null}
      {props.enabled && props.equityEur <= 0 ? (
        <Alert tone="warning">Deposit EUR balance on this executor before running a replay.</Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="text-sm">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert tone="success" className="text-sm">
          {message}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="brand"
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
              error?: string;
              barsReplayed?: number;
              candleRowsUpserted?: number;
            };
            if (!res.ok) {
              setError(body?.error ?? res.statusText);
              return;
            }
            setMessage(
              `Completed: ${body.barsReplayed ?? 0} bars replayed, ${body.candleRowsUpserted ?? 0} candle rows upserted during ingest.`,
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
    </div>
  );
}
