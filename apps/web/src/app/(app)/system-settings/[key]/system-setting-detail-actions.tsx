"use client";

import {
  deleteAutomationSetting,
  saveNumericSystemSetting,
} from "@/app/(app)/system-settings/actions";
import type { NumericSystemSettingDef } from "@/lib/system-settings/registry";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/adricore/blocks";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SystemSettingDetailActions({
  settingKey,
  label,
  def,
  currentNumeric,
}: {
  settingKey: string;
  label: string;
  def: Pick<NumericSystemSettingDef, "min" | "max" | "integer" | "envFallbackVar">;
  currentNumeric: number;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState(String(currentNumeric));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {message ? (
        <span className="mr-auto max-w-md text-xs text-red-600 dark:text-red-400" role="alert">
          {message}
        </span>
      ) : null}

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (o) {
            setDraft(String(currentNumeric));
            setMessage(null);
          }
        }}
      >
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={() => {
            setDraft(String(currentNumeric));
            setMessage(null);
            setEditOpen(true);
          }}
        >
          Edit
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Edit {label}</DialogTitle>
          <DialogDescription>
            Saves to <code className="bk-code">public.system_settings</code>. Effective on the next worker run (no
            dev-server restart). Range {def.min}–{def.max}
            {def.integer ? " (integer)." : "."}
          </DialogDescription>
          <div className="mt-3">
            <label htmlFor="system-setting-value" className="bk-form-label">
              Value
            </label>
            <input
              id="system-setting-value"
              className="bk-input mt-1 w-full font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={pending}
              inputMode="decimal"
            />
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              size="sm"
              loading={pending}
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("key", settingKey);
                  fd.set("value", draft);
                  const r = await saveNumericSystemSetting(fd);
                  if (r.ok) {
                    setEditOpen(false);
                    router.refresh();
                  } else {
                    setMessage(r.error);
                  }
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setMessage(null);
        }}
      >
        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>
            Removes the row for <code className="bk-code">{settingKey}</code>. The app will fall back to{" "}
            <code className="bk-code">{def.envFallbackVar}</code> and then the built-in default.
          </DialogDescription>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              loading={pending}
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("key", settingKey);
                  const r = await deleteAutomationSetting(fd);
                  if (r.ok) {
                    setDeleteOpen(false);
                    router.push("/system-settings");
                    router.refresh();
                  } else {
                    setMessage(r.error);
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
