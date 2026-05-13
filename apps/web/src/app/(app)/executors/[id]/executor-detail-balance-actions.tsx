"use client";

import { addExecutorBalance, removeExecutorBalance } from "@/app/(app)/executors/actions";
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

export function ExecutorDetailBalanceActions({
  executorId,
  assetOptions,
  preferredDepositAssetId,
}: {
  executorId: string;
  assetOptions: AssetOption[];
  /** When set and present in `assetOptions`, default Add/Remove asset (replay market quote). */
  preferredDepositAssetId?: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [pendingAdd, startAddTransition] = useTransition();
  const [pendingRemove, startRemoveTransition] = useTransition();

  const defaultAssetId = useMemo(() => {
    const pref = String(preferredDepositAssetId ?? "").trim();
    if (pref && assetOptions.some((o) => o.id === pref)) return pref;
    const eur = assetOptions.find((o) => o.code.toUpperCase() === "EUR");
    return eur?.id ?? assetOptions[0]?.id ?? "";
  }, [assetOptions, preferredDepositAssetId]);

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
          <DialogTitle>Add wallet balance</DialogTitle>
          <DialogDescription>
            Credit quantity to this executor wallet for the selected catalog asset. Appears in wallet transactions after save.
          </DialogDescription>
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
            <label className="bk-form-label text-xs" htmlFor={`${uid}-add-asset`}>
              Asset
            </label>
            <select
              id={`${uid}-add-asset`}
              name="asset_id"
              required
              className="bk-input w-full text-sm"
              defaultValue={defaultAssetId || undefined}
            >
              {assetOptions.length === 0 ? (
                <option value="">No assets loaded</option>
              ) : (
                assetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code}
                  </option>
                ))
              )}
            </select>
            <label className="bk-form-label text-xs" htmlFor={`${uid}-add-amt`}>
              Quantity
            </label>
            <input
              id={`${uid}-add-amt`}
              name="quantity"
              type="number"
              min="0.00000001"
              step="any"
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
              <Button type="submit" disabled={pendingAdd || assetOptions.length === 0} variant="brand" size="sm">
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
          <DialogTitle>Remove wallet balance</DialogTitle>
          <DialogDescription>
            Debits quantity from this executor wallet for the selected asset. Cannot exceed the current wallet sum for that asset.
          </DialogDescription>
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
            <label className="bk-form-label text-xs" htmlFor={`${uid}-rm-asset`}>
              Asset
            </label>
            <select
              id={`${uid}-rm-asset`}
              name="asset_id"
              required
              className="bk-input w-full text-sm"
              defaultValue={defaultAssetId || undefined}
            >
              {assetOptions.length === 0 ? (
                <option value="">No assets loaded</option>
              ) : (
                assetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code}
                  </option>
                ))
              )}
            </select>
            <label className="bk-form-label text-xs" htmlFor={`${uid}-rm-amt`}>
              Quantity
            </label>
            <input
              id={`${uid}-rm-amt`}
              name="quantity"
              type="number"
              min="0.00000001"
              step="any"
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
              <Button type="submit" disabled={pendingRemove || assetOptions.length === 0} variant="neutral" size="sm">
                Remove balance
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
