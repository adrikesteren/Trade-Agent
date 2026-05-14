"use client";

import { deleteExecutorQuoteBudget } from "@/app/(app)/executors/actions";
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

/**
 * Inline per-row "Delete" button for a quote-asset budget. Opens a confirm
 * dialog that removes the row from `trading.executor_quote_asset_budget`.
 *
 * Removing a quote asset disables that quote-asset book for this executor:
 * the mediator will skip markets with that quote with reason
 * `quote_asset_not_allowed` until a new budget is added.
 */
export function ExecutorQuoteBudgetDeleteDialog({
  executorId,
  budgetId,
  quoteAssetCode,
}: {
  executorId: string;
  budgetId: string;
  quoteAssetCode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setErr(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete {quoteAssetCode} budget?</DialogTitle>
          <DialogDescription>
            The mediator will skip markets quoted in <code className="bk-code">{quoteAssetCode}</code>
            {" "}for this executor (with reason <code className="bk-code">quote_asset_not_allowed</code>) until a
            new budget is added. This cannot be undone.
          </DialogDescription>
          {err ? <Alert tone="error">{err}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setErr(null);
              startTransition(async () => {
                try {
                  await deleteExecutorQuoteBudget(budgetId, executorId);
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
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
                {pending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
