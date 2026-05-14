"use client";

import { updateExecutorQuoteBudget } from "@/app/(app)/executors/actions";
import type { AssetOption } from "@/app/(app)/executors/executor-form";
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
import { useId, useMemo, useState, useTransition } from "react";

/**
 * Inline per-row "Edit" button for a quote-asset budget. Opens a dialog
 * pre-filled with the current row's quote asset and amount. The picker shows
 * the available options for the executor's exchange PLUS the row's current
 * quote asset (so it always stays visible even if it is no longer in the
 * available list).
 */
export function ExecutorQuoteBudgetEditDialog({
  executorId,
  budgetId,
  currentQuoteAssetId,
  currentQuoteAssetCode,
  currentMaxNotionalPrimary,
  availableOptions,
  primaryCode,
}: {
  executorId: string;
  budgetId: string;
  currentQuoteAssetId: string;
  currentQuoteAssetCode: string;
  currentMaxNotionalPrimary: string;
  /** Quote assets on this executor's exchange that don't have a budget row yet (excluding current). */
  availableOptions: AssetOption[];
  primaryCode: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = useMemo<AssetOption[]>(() => {
    const withCurrent = availableOptions.some((o) => o.id === currentQuoteAssetId)
      ? availableOptions
      : [...availableOptions, { id: currentQuoteAssetId, code: currentQuoteAssetCode }];
    return [...withCurrent].sort((a, b) => a.code.localeCompare(b.code));
  }, [availableOptions, currentQuoteAssetId, currentQuoteAssetCode]);

  return (
    <>
      <Button type="button" variant="neutral" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setErr(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Edit quote-asset budget</DialogTitle>
          <DialogDescription>
            Change the quote asset or the maximum notional (in <code className="bk-code">{primaryCode}</code>)
            for this executor.
          </DialogDescription>
          {err ? <Alert tone="error">{err}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              setErr(null);
              const fd = new FormData(form);
              startTransition(async () => {
                try {
                  await updateExecutorQuoteBudget(budgetId, executorId, fd);
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              });
            }}
          >
            <label className="bk-form-label text-xs" htmlFor={`${uid}-quote`}>
              Quote asset
            </label>
            <select
              id={`${uid}-quote`}
              name="quote_asset_id"
              required
              className="bk-input w-full font-mono text-sm"
              defaultValue={currentQuoteAssetId}
            >
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.code}
                </option>
              ))}
            </select>

            <label className="bk-form-label text-xs" htmlFor={`${uid}-amt`}>
              Max notional ({primaryCode})
            </label>
            <input
              id={`${uid}-amt`}
              name="max_notional_primary"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              required
              defaultValue={currentMaxNotionalPrimary}
              className="bk-input w-full font-mono text-sm"
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending} variant="brand" size="sm">
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
