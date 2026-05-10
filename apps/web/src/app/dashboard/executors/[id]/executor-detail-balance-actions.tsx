"use client";

import { addExecutorBalance, removeExecutorBalance } from "@/app/dashboard/executors/actions";
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/blocks";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

export function ExecutorDetailBalanceActions({ executorId }: { executorId: string }) {
  const router = useRouter();
  const uid = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [pendingAdd, startAddTransition] = useTransition();
  const [pendingRemove, startRemoveTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="neutral" size="sm" onClick={() => setAddOpen(true)}>
        Add balance
      </Button>
      <Button type="button" variant="neutral" size="sm" onClick={() => setRemoveOpen(true)}>
        Remove balance
      </Button>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddErr(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Add balance (EUR)</DialogTitle>
          <DialogDescription>Credit simulated EUR to this executor. Shown on the balance card after save.</DialogDescription>
          {addErr ? <Alert tone="error">{addErr}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              setAddErr(null);
              const fd = new FormData(form);
              startAddTransition(async () => {
                try {
                  await addExecutorBalance(executorId, fd);
                  form.reset();
                  setAddOpen(false);
                  router.refresh();
                } catch (e) {
                  setAddErr(e instanceof Error ? e.message : String(e));
                }
              });
            }}
          >
            <label className="bk-form-label text-xs" htmlFor={`${uid}-add-amt`}>
              Amount
            </label>
            <input
              id={`${uid}-add-amt`}
              name="amount_eur"
              type="number"
              min="0.01"
              step="0.01"
              required
              className="bk-input w-full font-mono text-sm"
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-add-note`}>
              Note (optional)
            </label>
            <input
              id={`${uid}-add-note`}
              name="note"
              type="text"
              className="bk-input w-full text-sm"
              maxLength={500}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pendingAdd} variant="brand" size="sm">
                Add balance
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          setRemoveOpen(open);
          if (!open) setRemoveErr(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Remove balance (EUR)</DialogTitle>
          <DialogDescription>Debits simulated EUR from this executor, subject to available equity.</DialogDescription>
          {removeErr ? <Alert tone="error">{removeErr}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              setRemoveErr(null);
              const fd = new FormData(form);
              startRemoveTransition(async () => {
                try {
                  await removeExecutorBalance(executorId, fd);
                  form.reset();
                  setRemoveOpen(false);
                  router.refresh();
                } catch (e) {
                  setRemoveErr(e instanceof Error ? e.message : String(e));
                }
              });
            }}
          >
            <label className="bk-form-label text-xs" htmlFor={`${uid}-rm-amt`}>
              Amount
            </label>
            <input
              id={`${uid}-rm-amt`}
              name="amount_eur"
              type="number"
              min="0.01"
              step="0.01"
              required
              className="bk-input w-full font-mono text-sm"
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-rm-note`}>
              Note (optional)
            </label>
            <input
              id={`${uid}-rm-note`}
              name="note"
              type="text"
              className="bk-input w-full text-sm"
              maxLength={500}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pendingRemove} variant="neutral" size="sm">
                Remove balance
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
