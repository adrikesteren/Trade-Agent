"use client";

import { deleteTask, updateTaskDetails } from "@/app/(app)/tasks/actions";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_OPTIONS = ["open", "in_progress", "completed", "cancelled"] as const;

function normalizeTaskStatus(s: string): (typeof STATUS_OPTIONS)[number] {
  return (STATUS_OPTIONS as readonly string[]).includes(s) ? (s as (typeof STATUS_OPTIONS)[number]) : "open";
}

export function TaskDetailHeaderActions({
  taskId,
  initialTitle,
  initialDescription,
  initialPriority,
  initialDueAtIso,
  initialStatus,
  subtaskCount,
  subtasksHref,
}: {
  taskId: string;
  initialTitle: string;
  initialDescription: string;
  initialPriority: string;
  initialDueAtIso: string | null;
  initialStatus: string;
  subtaskCount: number;
  subtasksHref: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [priority, setPriority] = useState(initialPriority);
  const [dueLocal, setDueLocal] = useState(() => isoToDatetimeLocalValue(initialDueAtIso));
  const [status, setStatus] = useState(() => normalizeTaskStatus(initialStatus));
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!editOpen) return;
    setTitle(initialTitle);
    setDescription(initialDescription);
    setPriority(initialPriority);
    setDueLocal(isoToDatetimeLocalValue(initialDueAtIso));
    setStatus(normalizeTaskStatus(initialStatus));
    setEditError(null);
  }, [editOpen, initialTitle, initialDescription, initialPriority, initialDueAtIso, initialStatus]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditError(null);
        }}
      >
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={() => {
            setEditError(null);
            setEditOpen(true);
          }}
        >
          Edit
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update title, description, priority, due date, and status.</DialogDescription>
          {editError ? (
            <Alert tone="error" className="mt-2 text-xs">
              {editError}
            </Alert>
          ) : null}
          <div className="bk-stack bk-stack_gap-sm mt-3">
            <label className="bk-form-label text-xs" htmlFor={`${uid}-title`}>
              Title
            </label>
            <input
              id={`${uid}-title`}
              className="bk-input w-full text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              autoComplete="off"
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-desc`}>
              Description
            </label>
            <textarea
              id={`${uid}-desc`}
              className="bk-input min-h-[5rem] w-full resize-y text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-prio`}>
              Priority
            </label>
            <input
              id={`${uid}-prio`}
              className="bk-input w-full text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={pending}
              placeholder="optional"
              autoComplete="off"
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-due`}>
              Due
            </label>
            <input
              id={`${uid}-due`}
              type="datetime-local"
              className="bk-input w-full text-sm"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              disabled={pending}
            />
            <label className="bk-form-label text-xs" htmlFor={`${uid}-status`}>
              Status
            </label>
            <select
              id={`${uid}-status`}
              className="bk-input w-full text-sm"
              value={status}
              onChange={(e) => setStatus(normalizeTaskStatus(e.target.value))}
              disabled={pending}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              size="sm"
              loading={pending}
              onClick={() => {
                setEditError(null);
                startTransition(async () => {
                  const dueAtIso = dueLocal.trim() ? new Date(dueLocal).toISOString() : null;
                  const r = await updateTaskDetails({
                    taskId,
                    title,
                    description: description.trim() ? description : null,
                    priority: priority.trim() ? priority : null,
                    dueAtIso,
                    status,
                  });
                  if (r.ok) {
                    setEditOpen(false);
                    router.refresh();
                  } else {
                    setEditError(r.error);
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
          if (!o) setDeleteError(null);
        }}
      >
        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogTitle>Delete this task?</DialogTitle>
          <DialogDescription>
            This cannot be undone.
            {subtaskCount > 0 ? (
              <>
                {" "}
                <strong>{subtaskCount}</strong> subtask{subtaskCount === 1 ? "" : "s"} will also be removed
                (cascade).
              </>
            ) : null}
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
                  const r = await deleteTask(taskId);
                  if (r.ok) {
                    setDeleteOpen(false);
                    router.push("/tasks");
                    router.refresh();
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

      {subtaskCount > 0 ? (
        <Link href={subtasksHref} className="bk-link text-sm">
          Subtasks ({subtaskCount})
        </Link>
      ) : null}
    </div>
  );
}
