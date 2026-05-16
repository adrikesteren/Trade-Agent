"use client";

import { enqueueMarketEvaluateAllSignalsViaRelay } from "@/app/(app)/markets/[id]/actions";
import { Alert, Button } from "@adrikesteren/adricore/blocks";
import { useState, useTransition } from "react";

type Props = {
  marketId: string;
};

/** Slugs the "Re-evaluate regime" button forces an overwrite for. */
const FORCE_REGIME_SLUGS = ["regime-classifier-15m-v1"] as const;

/**
 * Header action: re-runs the Signal Agent over **every stored 15m candle** for this market.
 *
 * - "Evaluate signals" → skip-existing (`(agent, candle)` tuples that already have signals
 *   for the automation user are skipped). Use to fill gaps after a backfill.
 * - "Re-evaluate regime" → force overwrite for `regime-classifier-15m-v1` only. Use after
 *   the regime classifier seed config changes (e.g. trend timeframe / maPeriod). Existing
 *   signal rows are upserted in place so the row id is preserved (decisions/orders FKs
 *   stay valid).
 *
 * Dispatched via Relay as a sequential **message group** — the market history is split
 * into ~30-day UTC chunks and each chunk is one Relay message inside the group. Each
 * chunk has its own per-message timeout / retry budget; partial progress survives a
 * single chunk failure. Click again to resume (the worker is idempotent and skip-existing
 * for the non-force button).
 */
export function MarketHeaderEvaluateSignalsButton({ marketId }: Props) {
  const [feedback, setFeedback] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(forceAgentSlugs: readonly string[], modeLabel: string) {
    setFeedback(null);
    startTransition(async () => {
      const r = await enqueueMarketEvaluateAllSignalsViaRelay(marketId, { forceAgentSlugs });
      if (!r.ok) {
        setFeedback({ tone: "error", text: r.error });
        return;
      }
      if (r.queued) {
        const chunkCount = r.chunkCount ?? 1;
        const handle =
          chunkCount > 1 && r.relayMessageGroupId
            ? `group ${r.relayMessageGroupId.slice(0, 8)}…`
            : r.relayMessageId
              ? `message ${r.relayMessageId.slice(0, 8)}…`
              : "queued";
        const noun = chunkCount === 1 ? "chunk" : "chunks";
        setFeedback({
          tone: "success",
          text: `${modeLabel} queued via Relay — ${chunkCount} ${noun} (${handle}). Ensure Relay dispatch is running; results land in Sync Runs.`,
        });
        return;
      }
      if (r.skipped) {
        setFeedback({
          tone: "info",
          text: "Another evaluate-all run is already in progress for this job. Try again shortly.",
        });
        return;
      }
      const total = r.candleTotal ?? 0;
      const processed = r.barsProcessed ?? 0;
      const upserted = r.signalsUpserted ?? 0;
      if (total === 0) {
        setFeedback({ tone: "info", text: "No stored candles for this market yet." });
        return;
      }
      const tail = r.deadlineHit ? " · 9-min budget hit; click again to resume the rest." : "";
      setFeedback({
        tone: "success",
        text: `${modeLabel}: evaluated ${processed} of ${total} bars · ${upserted} signals upserted.${tail}`,
      });
    });
  }

  return (
    <div className="flex max-w-[min(100%,22rem)] flex-col items-end gap-2">
      {feedback ? (
        <Alert tone={feedback.tone} className="text-left text-xs">
          {feedback.text}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="neutral"
          size="sm"
          disabled={pending}
          title="Run signal agents on every stored candle (chunked Relay group, ~30 days per chunk, skip-existing)"
          onClick={() => run([], "Evaluate signals")}
        >
          {pending ? "Evaluate…" : "Evaluate signals"}
        </Button>
        <Button
          type="button"
          variant="neutral"
          size="sm"
          disabled={pending}
          title="Force regime classifier re-evaluation (overwrites stale rows after a config change)"
          onClick={() => run(FORCE_REGIME_SLUGS, "Re-evaluate regime")}
        >
          {pending ? "Regime…" : "Re-evaluate regime"}
        </Button>
      </div>
    </div>
  );
}
