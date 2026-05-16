"use client";

import {
  ExecutorForm,
  type AssetOption,
  type ExchangeCapabilities,
  type ExchangeOption,
  type ExecutorFormInitial,
} from "@/app/(app)/executors/executor-form";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@adrikesteren/adricore/blocks";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExecutorEditDialog({
  executorId,
  assetOptions,
  exchangeOptions,
  quoteAssetOptionsByExchange,
  exchangeCapabilitiesById,
  primaryAssetCode,
  initial,
}: {
  executorId: string;
  assetOptions: AssetOption[];
  exchangeOptions: ExchangeOption[];
  quoteAssetOptionsByExchange?: Record<string, AssetOption[]>;
  exchangeCapabilitiesById?: Record<string, ExchangeCapabilities>;
  primaryAssetCode?: string;
  initial: ExecutorFormInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="neutral"
        size="sm"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        Edit
      </Button>
      <DialogContent className="max-h-[min(90vh,48rem)] w-[min(92vw,44rem)] overflow-y-auto">
        <DialogTitle>Edit executor</DialogTitle>
        <DialogDescription>Save applies immediately to this portfolio and mediator settings.</DialogDescription>
        <div className="mt-2">
          <ExecutorForm
            key={formKey}
            mode="edit"
            executorId={executorId}
            assetOptions={assetOptions}
            exchangeOptions={exchangeOptions}
            quoteAssetOptionsByExchange={quoteAssetOptionsByExchange}
            exchangeCapabilitiesById={exchangeCapabilitiesById}
            primaryAssetCode={primaryAssetCode}
            initial={initial}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
