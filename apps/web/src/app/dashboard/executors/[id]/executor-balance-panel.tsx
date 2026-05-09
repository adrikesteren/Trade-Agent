"use client";

import { addExecutorBalance, removeExecutorBalance } from "@/app/dashboard/executors/actions";
import { Alert, Button } from "@repo/blocks";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ExecutorBalancePanel({ executorId }: { executorId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function wrap(
    fn: (executorId: string, formData: FormData) => Promise<void>,
    form: HTMLFormElement,
  ) {
    setErr(null);
    const fd = new FormData(form);
    startTransition(async () => {
      try {
        await fn(executorId, fd);
        form.reset();
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="bk-stack bk-stack_gap-md">
      {err ? <Alert tone="error">{err}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <form
          className="bk-stack bk-stack_gap-sm rounded-md border border-[var(--bk-border)] p-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            wrap(addExecutorBalance, ev.currentTarget);
          }}
        >
          <p className="text-sm font-medium">Add balance (EUR)</p>
          <label className="bk-form-label text-xs" htmlFor={`add-amt-${executorId}`}>
            Amount
          </label>
          <input
            id={`add-amt-${executorId}`}
            name="amount_eur"
            type="number"
            min="0.01"
            step="0.01"
            required
            className="bk-input w-full max-w-xs font-mono text-sm"
          />
          <label className="bk-form-label text-xs" htmlFor={`add-note-${executorId}`}>
            Note (optional)
          </label>
          <input
            id={`add-note-${executorId}`}
            name="note"
            type="text"
            className="bk-input w-full max-w-md text-sm"
            maxLength={500}
          />
          <Button type="submit" disabled={pending} variant="brand">
            Add balance
          </Button>
        </form>

        <form
          className="bk-stack bk-stack_gap-sm rounded-md border border-[var(--bk-border)] p-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            wrap(removeExecutorBalance, ev.currentTarget);
          }}
        >
          <p className="text-sm font-medium">Remove balance (EUR)</p>
          <label className="bk-form-label text-xs" htmlFor={`rm-amt-${executorId}`}>
            Amount
          </label>
          <input
            id={`rm-amt-${executorId}`}
            name="amount_eur"
            type="number"
            min="0.01"
            step="0.01"
            required
            className="bk-input w-full max-w-xs font-mono text-sm"
          />
          <label className="bk-form-label text-xs" htmlFor={`rm-note-${executorId}`}>
            Note (optional)
          </label>
          <input
            id={`rm-note-${executorId}`}
            name="note"
            type="text"
            className="bk-input w-full max-w-md text-sm"
            maxLength={500}
          />
          <Button type="submit" disabled={pending} variant="neutral">
            Remove balance
          </Button>
        </form>
      </div>
    </div>
  );
}
