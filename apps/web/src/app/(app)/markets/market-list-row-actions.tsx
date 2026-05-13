"use client";

import { deleteCatalogMarket } from "@/app/(app)/markets/actions";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/adricore/blocks";
import Link from "next/link";
import { useState, useTransition } from "react";

type AssetMini = { id: string; code: string; name: string | null };

function assetLabel(a: AssetMini): string {
  const n = a.name?.trim();
  return n ? n : a.code;
}

function assetHref(a: AssetMini): string {
  return `/assets/${encodeURIComponent(a.code)}`;
}

export function MarketListRowActions({
  marketId,
  marketSymbol,
  baseAsset,
  quoteAsset,
}: {
  marketId: string;
  marketSymbol: string;
  baseAsset: AssetMini | null;
  quoteAsset: AssetMini | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <Button type="button" variant="neutral" size="sm" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Market</DialogTitle>
          <DialogDescription>Review the pair and open the full record for sync actions.</DialogDescription>
          <div className="bk-stack bk-stack_gap-sm mt-2 text-sm">
            <p>
              <span className="bk-text-muted">Symbol</span>{" "}
              <span className="font-mono text-[var(--text)]">{marketSymbol}</span>
            </p>
            <p>
              <span className="bk-text-muted">Base</span>{" "}
              {baseAsset ? (
                <Link href={assetHref(baseAsset)} className="bk-link font-medium">
                  {assetLabel(baseAsset)}
                </Link>
              ) : (
                "—"
              )}
            </p>
            <p>
              <span className="bk-text-muted">Quote</span>{" "}
              {quoteAsset ? (
                <Link href={assetHref(quoteAsset)} className="bk-link font-medium">
                  {assetLabel(quoteAsset)}
                </Link>
              ) : (
                "—"
              )}
            </p>
          </div>
          <DialogFooter className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
              Close
            </Button>
            <Button type="button" variant="brand" size="sm" asChild>
              <Link href={`/markets/${marketId}`} onClick={() => setEditOpen(false)}>
                Open record
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setDeleteError(null);
        }}
      >
        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Delete this market?</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs text-[var(--text)]">{marketSymbol}</span>
            <br />
            <span className="mt-2 inline-block">
              This action is not available for catalog markets that are synced from the exchange.
            </span>
          </DialogDescription>
          {deleteError ? (
            <Alert tone="error" className="mt-2 text-xs">
              {deleteError}
            </Alert>
          ) : null}
          <DialogFooter className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              loading={pending}
              onClick={() => {
                setDeleteError(null);
                startTransition(async () => {
                  const r = await deleteCatalogMarket(marketId);
                  if (r.ok) {
                    setDeleteOpen(false);
                  } else {
                    setDeleteError(r.error);
                  }
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
