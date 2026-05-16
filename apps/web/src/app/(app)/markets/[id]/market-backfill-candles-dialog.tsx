"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@adrikesteren/adricore/blocks";
import { useId, useState, useTransition } from "react";

import { enqueueMarketBackfillCandlesViaRelay } from "@/app/(app)/markets/[id]/actions";

// TODO(v1-migration): this dialog already enqueues a chunked Relay group via the
// `enqueueMarketBackfillCandlesViaRelay` server action. In a follow-up session this
// can be swapped to POST `/api/v1/agents/ingest/retrieve-candles` (or its async
// chunked equivalent) once that route is wired up end-to-end.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtcYmd(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type Props = {
  marketId: string;
  marketSymbol?: string | null;
};

type SuccessFeedback = {
  chunkCount: number;
  groupId: string | null;
  messageId: string | null;
  inline: boolean;
};

/**
 * Header action: opens a popup with a `startDate` (required) + `endDate` (optional, defaults to today UTC)
 * form. On Run we enqueue the {@link enqueueMarketBackfillCandlesViaRelay} job — when Relay is configured
 * the work is split into UTC day chunks and published as a sequential Relay message group so each chunk
 * gets its own timeout / retry budget. The dialog stays open with a success summary so the user can copy
 * the group id; clicking Close (or hitting esc) dismisses it.
 */
export function MarketBackfillCandlesDialog({ marketId, marketSymbol }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessFeedback | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayUtcYmd();

  const reset = () => {
    setStartDate("");
    setEndDate("");
    setError(null);
    setSuccess(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="brand"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Backfill candles
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setError(null);
            setSuccess(null);
          }
        }}
      >
        <DialogContent className="w-[min(92vw,30rem)]">
          <DialogTitle>
            Backfill candles{marketSymbol ? ` — ${marketSymbol}` : ""}
          </DialogTitle>
          <DialogDescription>
            Ingest Bitvavo OHLCV history into the catalog. Dates are inclusive UTC. Leave the end date empty to
            use today. Long ranges are split into chunks and published as a sequential Relay message group.
          </DialogDescription>

          {error ? <Alert tone="error">{error}</Alert> : null}
          {success ? (
            <Alert tone="success">
              {success.inline
                ? `Ran inline — ${success.chunkCount} backfill completed.`
                : success.chunkCount === 1
                  ? `Queued 1 backfill chunk on Relay${success.messageId ? ` (message ${success.messageId.slice(0, 8)}…)` : ""}.`
                  : `Queued ${success.chunkCount} backfill chunks on Relay${success.groupId ? ` (group ${success.groupId.slice(0, 8)}…)` : ""}.`}
            </Alert>
          ) : null}

          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setError(null);
              setSuccess(null);

              const start = startDate.trim();
              const end = endDate.trim();
              if (!ISO_DATE_RE.test(start)) {
                setError("Start date is required (YYYY-MM-DD).");
                return;
              }
              if (end && !ISO_DATE_RE.test(end)) {
                setError("End date must be a YYYY-MM-DD UTC date.");
                return;
              }
              if (end && start > end) {
                setError("Start date must be on or before end date.");
                return;
              }

              startTransition(async () => {
                const r = await enqueueMarketBackfillCandlesViaRelay({
                  marketId,
                  startDate: start,
                  endDate: end || null,
                });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setSuccess({
                  chunkCount: r.chunkCount ?? 1,
                  groupId: r.groupId ?? null,
                  messageId: null,
                  inline: !r.queued,
                });
              });
            }}
          >
            <div className="bk-stack bk-stack_gap-xs">
              <label className="bk-form-label text-xs" htmlFor={`${uid}-start`}>
                Start date <span className="bk-text-muted">(required, UTC)</span>
              </label>
              <input
                id={`${uid}-start`}
                name="startDate"
                type="date"
                required
                value={startDate}
                max={today}
                onChange={(e) => setStartDate(e.target.value)}
                className="bk-input w-full font-mono text-sm"
              />
            </div>

            <div className="bk-stack bk-stack_gap-xs">
              <label className="bk-form-label text-xs" htmlFor={`${uid}-end`}>
                End date <span className="bk-text-muted">(optional — defaults to today UTC)</span>
              </label>
              <input
                id={`${uid}-end`}
                name="endDate"
                type="date"
                value={endDate}
                max={today}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder={today}
                className="bk-input w-full font-mono text-sm"
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm" disabled={pending}>
                  {success ? "Close" : "Cancel"}
                </Button>
              </DialogClose>
              <Button type="submit" variant="brand" size="sm" disabled={pending}>
                {pending ? "Queueing…" : success ? "Run again" : "Run"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
