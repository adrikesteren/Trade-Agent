"use client";

import { deleteCatalogAsset } from "@/app/(app)/assets/actions";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/adricore/blocks";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AssetDetailDeleteHeaderActions({
  assetId,
  assetCode,
  assetName,
}: {
  assetId: string;
  assetCode: string;
  assetName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = assetName.trim() || assetCode;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <DialogContent className="w-[min(92vw,28rem)]">
        <DialogTitle>Delete this asset?</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-[var(--text)]">{label}</span>
          <span className="bk-text-muted"> · </span>
          <span className="font-mono text-xs">{assetCode}</span>
          <br />
          <span className="mt-2 inline-block">This cannot be undone. Markets must not reference this asset.</span>
        </DialogDescription>
        {error ? (
          <Alert tone="error" className="mt-2 text-xs">
            {error}
          </Alert>
        ) : null}
        <DialogFooter className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            loading={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await deleteCatalogAsset(assetId);
                if (r.ok) {
                  setOpen(false);
                  router.push("/assets");
                  router.refresh();
                } else {
                  setError(r.error);
                }
              });
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
