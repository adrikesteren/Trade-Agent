"use server";

import { revalidatePath } from "next/cache";

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

  const { data: row, error: selErr } = await supabase
    .from("tasks")
    .select("id, related_schema, related_table, related_id, parent_task_id")
    .eq("id", taskId)
    .maybeSingle();

  if (selErr || !row) {
    return { ok: false, error: selErr?.message ?? "Task not found." };
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
  const { data: updated, error: upErr } = await supabase
    .from("tasks")
    .update({
      title,
      description,
      priority,
      due_at,
      status,
      updated_at: now,
    })
    .eq("id", taskId)
    .select("id");

  if (upErr) {
    return { ok: false, error: upErr.message };
  }
  if (!updated?.length) {
    return {
      ok: false,
      error: "Nothing was updated: no matching row (missing migration for task RLS, or task id invalid).",
    };
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/tasks/${taskId}/tasks`);
  const parentId = (row as { parent_task_id?: string | null }).parent_task_id;
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

  const { data: row, error: selErr } = await supabase
    .from("tasks")
    .select("id, related_schema, related_table, related_id, parent_task_id")
    .eq("id", id)
    .maybeSingle();

  if (selErr || !row) {
    return { ok: false, error: selErr?.message ?? "Task not found." };
  }

  const parentId = (row as { parent_task_id?: string | null }).parent_task_id;

  const { data: deleted, error: delErr } = await supabase.from("tasks").delete().eq("id", id).select("id");

  if (delErr) {
    return { ok: false, error: delErr.message };
  }
  if (!deleted?.length) {
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
