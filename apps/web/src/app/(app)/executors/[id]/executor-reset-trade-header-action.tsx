"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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

type ResetResponse = {
  ok?: boolean;
  error?: string;
  fillsDeleted?: number;
  ordersDeleted?: number;
  decisionsDeleted?: number;
  positionsDeleted?: number;
  movingFloorsDeleted?: number;
  historicalRunsDeleted?: number;
  walletTransactionsDeleted?: number;
  walletAssetBalancesDeleted?: number;
};

/**
 * Header action: wipe everything the trade-mediator + executor produced for this
 * **historical** executor (decisions, orders, fills, positions, moving floors, run
 * history) **and** its `historical_paper` wallet ledger (transactions + per-asset
 * balances). Risk counters on the executor row are reset to zero / kill switch off.
 *
 * After confirmation the user re-deposits via the existing balance actions and runs
 * a fresh replay. The dialog requires explicit confirmation because there is no undo.
 */
export function ExecutorResetTradeHeaderAction({ executorId }: { executorId: string }) {
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
        title="Delete all decisions, orders, fills, positions, moving floors, run history, and wallet ledger for this historical executor."
        onClick={() => {
          setError(null);
          setSummary(null);
          setOpen(true);
        }}
      >
        Reset trade
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
          <DialogTitle>Reset trade for this historical executor?</DialogTitle>
          <DialogDescription>
            This permanently deletes every row produced by the trade-mediator and executor for
            this executor: <code className="bk-code">decisions</code>,{" "}
            <code className="bk-code">orders</code>, <code className="bk-code">fills</code>,{" "}
            <code className="bk-code">positions</code>,{" "}
            <code className="bk-code">executor_moving_floors</code> and{" "}
            <code className="bk-code">executor_historical_runs</code>. The dedicated{" "}
            <code className="bk-code">historical_paper</code> wallet is also cleared (transactions
            + per-asset balances) so you can re-deposit and replay from scratch. Runtime risk
            counters and the kill switch are reset. <strong>This cannot be undone.</strong>
          </DialogDescription>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setError(null);
              startTransition(async () => {
                try {
                  const res = await fetch(
                    `/api/executors/${encodeURIComponent(executorId)}/reset-trade`,
                    { method: "POST" },
                  );
                  const body = (await res.json()) as ResetResponse;
                  if (!res.ok || !body.ok) {
                    setError(body?.error ?? res.statusText);
                    return;
                  }
                  setOpen(false);
                  setSummary(
                    `Wiped ${body.decisionsDeleted ?? 0} decisions · ${body.ordersDeleted ?? 0} orders · ${body.fillsDeleted ?? 0} fills · ${body.positionsDeleted ?? 0} positions · ${body.movingFloorsDeleted ?? 0} floors · ${body.historicalRunsDeleted ?? 0} runs · ${body.walletTransactionsDeleted ?? 0} txs · ${body.walletAssetBalancesDeleted ?? 0} balances.`,
                  );
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
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
                {pending ? "Resetting…" : "Reset trade"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
