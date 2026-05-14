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
} from "@repo/adricore/blocks";
import { useId, useState, useTransition } from "react";

import { enqueueMarketBackfillCandlesViaRelay } from "@/app/(app)/markets/[id]/actions";

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

/**
 * Header action: opens a popup with a `startDate` (required) + `endDate` (optional, defaults to today UTC)
 * form. On Run we enqueue the {@link enqueueMarketBackfillCandlesViaRelay} job on the Relay App with a
 * 30-minute timeout, then close the dialog.
 */
export function MarketBackfillCandlesDialog({ marketId, marketSymbol }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayUtcYmd();

  const reset = () => {
    setStartDate("");
    setEndDate("");
    setError(null);
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
          if (!next) setError(null);
        }}
      >
        <DialogContent className="w-[min(92vw,30rem)]">
          <DialogTitle>
            Backfill candles{marketSymbol ? ` — ${marketSymbol}` : ""}
          </DialogTitle>
          <DialogDescription>
            Ingest Bitvavo OHLCV history into the catalog and run the Signal Agent for every closed bar in the
            range. Dates are inclusive UTC. Leave the end date empty to use today.
          </DialogDescription>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setError(null);

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
                setOpen(false);
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
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="brand" size="sm" disabled={pending}>
                {pending ? "Running…" : "Run"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
