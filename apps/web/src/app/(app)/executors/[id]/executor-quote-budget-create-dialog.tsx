"use client";

import { createExecutorQuoteBudget } from "@/app/(app)/executors/actions";
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
} from "@adrikesteren/adricore/blocks";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/**
 * Header action on the executor detail "Quote-asset budgets" related list.
 *
 * Shows a "New" button that opens a dialog with a quote-asset picker (filtered
 * to options on this executor's exchange that don't already have a budget) and
 * a numeric `max_notional_primary` input. Submits via `createExecutorQuoteBudget`.
 */
export function ExecutorQuoteBudgetCreateDialog({
  executorId,
  availableOptions,
  primaryCode,
}: {
  executorId: string;
  /** Quote assets on this executor's exchange that don't have a budget row yet. */
  availableOptions: AssetOption[];
  /** Currency code for the `max_notional_primary` label (e.g. `EUR`). */
  primaryCode: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noOptions = availableOptions.length === 0;

  return (
    <>
      <Button
        type="button"
        variant="neutral"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={noOptions}
        title={
          noOptions
            ? "Every quote asset on this exchange already has a budget. Edit an existing row to change it."
            : "Add a quote-asset budget for this executor."
        }
      >
        New
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setErr(null);
        }}
      >
        <DialogContent>
          <DialogTitle>New quote-asset budget</DialogTitle>
          <DialogDescription>
            One row per quote asset on this executor&rsquo;s exchange. Notional is stored in your primary
            fiat (<code className="bk-code">{primaryCode}</code>) and converted to the market quote at
            decision time.
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
                  await createExecutorQuoteBudget(executorId, fd);
                  form.reset();
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
              defaultValue=""
            >
              <option value="" disabled>
                {noOptions ? "(no quote assets available)" : "— Select quote —"}
              </option>
              {availableOptions.map((opt) => (
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
              defaultValue="100"
              className="bk-input w-full font-mono text-sm"
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending || noOptions} variant="brand" size="sm">
                {pending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
