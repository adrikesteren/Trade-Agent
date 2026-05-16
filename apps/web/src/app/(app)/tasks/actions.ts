"use server";

import { revalidatePath } from "next/cache";

import * as TasksSelector from "@/lib/selectors/tasks-selector";
import { resolveRelatedHref } from "@/lib/tasks/resolve-related-href";
import { DASHBOARD_TASK_EDITABLE_STATUSES } from "@/lib/tasks/task-statuses";
import { createClient } from "@/lib/supabase/server";

const TASK_STATUSES = new Set<string>(DASHBOARD_TASK_EDITABLE_STATUSES);

export type TaskMutationResult = { ok: true } | { ok: false; error: string };

/**
 * Updates editable task fields (same RLS as status: own task or dashboard administrator).
 */
export async function updateTaskDetails(input: {
  taskId: string;
  title: string;
  description: string | null;
  priority: string | null;
  dueAtIso: string | null;
  status: string;
}): Promise<TaskMutationResult> {
  const taskId = input.taskId.trim();
  const title = input.title.trim();
  const status = input.status.trim();
  if (!taskId || !title) {
    return { ok: false, error: "Title is required." };
  }
  if (!TASK_STATUSES.has(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  let row: Awaited<ReturnType<typeof TasksSelector.selectRelatedAndParentById>>;
  try {
    row = await TasksSelector.selectRelatedAndParentById(supabase, taskId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!row) {
    return { ok: false, error: "Task not found." };
  }

  const description = input.description?.trim() ? input.description.trim() : null;
  const priority = input.priority?.trim() ? input.priority.trim() : null;
  let due_at: string | null = null;
  if (input.dueAtIso?.trim()) {
    const d = new Date(input.dueAtIso.trim());
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Invalid due date." };
    }
    due_at = d.toISOString();
  }

  const now = new Date().toISOString();
  let updated: { id: string }[];
  try {
    updated = await TasksSelector.updateByIdReturningIds(supabase, {
      id: taskId,
      patch: { title, description, priority, due_at, status, updated_at: now },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!updated.length) {
    return {
      ok: false,
      error: "Nothing was updated: no matching row (missing migration for task RLS, or task id invalid).",
    };
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/tasks/${taskId}/tasks`);
  const parentId = row.parent_task_id;
  if (parentId) {
    revalidatePath(`/tasks/${parentId}/tasks`);
  }

  const href = resolveRelatedHref(
    String(row.related_schema ?? ""),
    String(row.related_table ?? ""),
    String(row.related_id ?? ""),
  );
  if (href) {
    revalidatePath(href);
  }

  return { ok: true };
}

/**
 * Deletes the task (and subtasks, via FK cascade). Same RLS as update.
 */
export async function deleteTask(taskId: string): Promise<TaskMutationResult> {
  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Invalid task." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  let row: Awaited<ReturnType<typeof TasksSelector.selectRelatedAndParentById>>;
  try {
    row = await TasksSelector.selectRelatedAndParentById(supabase, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!row) {
    return { ok: false, error: "Task not found." };
  }

  const parentId = row.parent_task_id;

  let deleted: { id: string }[];
  try {
    deleted = await TasksSelector.deleteByIdReturningIds(supabase, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!deleted.length) {
    return { ok: false, error: "Delete had no effect (no matching row or access denied)." };
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  revalidatePath(`/tasks/${id}/tasks`);
  if (parentId) {
    revalidatePath(`/tasks/${parentId}/tasks`);
  }

  const href = resolveRelatedHref(
    String(row.related_schema ?? ""),
    String(row.related_table ?? ""),
    String(row.related_id ?? ""),
  );
  if (href) {
    revalidatePath(href);
  }

  return { ok: true };
}
