"use client";

import { setAssetCoingeckoCoinId } from "@/app/dashboard/assets/actions";
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

type SetDialogProps = {
  assetId: string;
  initialCoingeckoCoinId: string | null;
};

/** Shown in the asset header when `coingecko_coin_id` is not set yet. */
export function AssetSetCoingeckoIdDialog({ assetId, initialCoingeckoCoinId }: SetDialogProps) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [value, setValue] = useState(initialCoingeckoCoinId ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="neutral"
        size="sm"
        onClick={() => {
          setValue(initialCoingeckoCoinId ?? "");
          setErr(null);
          setOpen(true);
        }}
      >
        Set CoinGecko coin id
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setErr(null);
        }}
      >
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Set CoinGecko coin id</DialogTitle>
          <DialogDescription>
            Use the CoinGecko API coin id (e.g. <span className="font-mono">bitcoin</span> for BTC). Leave empty
            to clear. Metrics sync uses this id for <span className="font-mono">/coins/markets</span>.
          </DialogDescription>
          {err ? <Alert tone="error">{err}</Alert> : null}
          <form
            className="bk-stack bk-stack_gap-sm mt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              setErr(null);
              startTransition(async () => {
                try {
                  await setAssetCoingeckoCoinId(assetId, value);
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              });
            }}
          >
            <label className="bk-form-label text-xs" htmlFor={`${uid}-cg-id`}>
              CoinGecko coin id
            </label>
            <input
              id={`${uid}-cg-id`}
              name="coingecko_coin_id"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. bitcoin"
              autoComplete="off"
              className="bk-input w-full font-mono text-sm"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending} variant="brand" size="sm">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type HeaderActionsProps = {
  assetId: string;
  coingeckoCoinId: string | null | undefined;
};

/**
 * Asset header: “Set CoinGecko coin id” when no id is stored; “Open in CoinGecko” when an id exists.
 */
export function AssetCoingeckoHeaderActions({ assetId, coingeckoCoinId }: HeaderActionsProps) {
  const trimmed = typeof coingeckoCoinId === "string" ? coingeckoCoinId.trim() : "";
  if (trimmed) {
    const href = `https://www.coingecko.com/en/coins/${encodeURIComponent(trimmed)}`;
    return (
      <Button asChild variant="neutral" size="sm">
        <a href={href} target="_blank" rel="noopener noreferrer">
          Open in CoinGecko
        </a>
      </Button>
    );
  }
  return <AssetSetCoingeckoIdDialog assetId={assetId} initialCoingeckoCoinId={coingeckoCoinId ?? null} />;
}
