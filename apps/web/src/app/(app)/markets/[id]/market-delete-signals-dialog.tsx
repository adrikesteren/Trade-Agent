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
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteAllSignalsForMarketAction } from "@/app/(app)/markets/[id]/actions";

type Props = {
  marketId: string;
  marketSymbol?: string | null;
};

/**
 * Header action: wipes every `trading.signals` row whose `candle_id` belongs to this
 * market. Because of the FK cascade chain on `signals.id`, this also removes:
 *
 * - `trading.decisions` rows referencing those signals (CASCADE)
 * - `trading.orders` for those decisions (CASCADE)
 * - `trading.fills` for those orders (CASCADE)
 *
 * `trading.positions` are **not** in the cascade chain and survive — the user is warned
 * about this in the dialog so they can manually reconcile (e.g. via the executor's
 * "Reset trade" header action) when needed.
 *
 * The action requires explicit confirmation because it is destructive and irreversible.
 */
export function MarketDeleteSignalsDialog({ marketId, marketSymbol }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <div className="flex max-w-[14rem] flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={
          marketSymbol
            ? `Delete every signal (and cascade decisions/orders/fills) for ${marketSymbol}.`
            : "Delete every signal (and cascade decisions/orders/fills) for this market."
        }
        onClick={() => {
          setError(null);
          setSummary(null);
          setOpen(true);
        }}
      >
        Delete signals
      </Button>
      {summary ? (
        <p
          className="text-right text-[0.6875rem] leading-snug text-emerald-700 dark:text-emerald-400"
          role="status"
        >
          {summary}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            Delete all signals{marketSymbol ? ` — ${marketSymbol}` : ""}?
          </DialogTitle>
          <DialogDescription>
            This permanently removes every <code className="bk-code">trading.signals</code> row
            whose candle belongs to this market. By database FK cascade, the following are
            also removed for the affected signals:
            {" "}<code className="bk-code">trading.decisions</code>,{" "}
            <code className="bk-code">trading.orders</code> and{" "}
            <code className="bk-code">trading.fills</code>.{" "}
            <strong>Positions are not cascaded</strong> — any open position on this market for
            an executor that traded it will remain. Use the executor's "Reset trade" header
            action if you also want to clear positions and the wallet ledger.{" "}
            <strong>This cannot be undone.</strong>
          </DialogDescription>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setError(null);
              startTransition(async () => {
                const result = await deleteAllSignalsForMarketAction(marketId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                setSummary(
                  `Deleted ${result.signalsDeleted} signal${result.signalsDeleted === 1 ? "" : "s"} (scanned ${result.candlesScanned} candle${result.candlesScanned === 1 ? "" : "s"}). Decisions, orders and fills for those signals were cascaded.`,
                );
                router.refresh();
              });
            }}
          >
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending} variant="neutral" size="sm">
                {pending ? "Deleting…" : "Delete signals"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
