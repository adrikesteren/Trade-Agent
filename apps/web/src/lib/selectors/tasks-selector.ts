import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types
// ──────────────────────────────────────────────────────────────────────────────

/** Narrow id-only projection (used by skip-task / duplicate-task probes). */
export type TaskIdRow = { id: string };

/** `select("id, title")` — parent-task lookup. */
export type TaskIdTitleRow = { id: string; title: string };

/** `select("title")` — narrow parent-title lookup. */
export type TaskTitleRow = { title: string };

/** Related-list / subtasks card projection. */
export type TaskRelatedListRow = {
  id: string;
  title: string;
  status: string;
  task_type: string;
  created_at: string;
};

/** Root-list page projection (`tasks/page.tsx`). */
export type TaskRootListRow = {
  id: string;
  title: string;
  status: string;
  task_type: string;
  related_schema: string;
  related_table: string;
  related_id: string;
  created_at: string;
};

/** Update/delete action lookup projection. */
export type TaskRelatedAndParentRow = {
  id: string;
  related_schema: string;
  related_table: string;
  related_id: string;
  parent_task_id: string | null;
};

/** Detail-page (`[id]/page.tsx`) wide projection. */
export type TaskDetailRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  due_at: string | null;
  related_schema: string;
  related_table: string;
  related_id: string;
  parent_task_id: string | null;
  task_type: string;
  job_identifier: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const TASK_DETAIL_FIELDS =
  "id, title, description, status, priority, due_at, related_schema, related_table, related_id, parent_task_id, task_type, job_identifier, metadata, created_at, updated_at";

const TASK_RELATED_LIST_FIELDS = "id, title, status, task_type, created_at";

const TASK_ROOT_LIST_FIELDS =
  "id, title, status, task_type, related_schema, related_table, related_id, created_at";

const TASK_RELATED_AND_PARENT_FIELDS =
  "id, related_schema, related_table, related_id, parent_task_id";

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/** `select(TASK_DETAIL_FIELDS) .eq("id", id) .maybeSingle()` — task detail page. */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<TaskDetailRow | null> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_DETAIL_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TaskDetailRow | null) ?? null;
}

/** `select("id, title") .eq("id", id) .maybeSingle()` — parent-task header lookup. */
export async function selectIdAndTitleById(
  client: SupabaseClient,
  id: string,
): Promise<TaskIdTitleRow | null> {
  const { data, error } = await client
    .from("tasks")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TaskIdTitleRow | null) ?? null;
}

/** `select("title") .eq("id", id) .maybeSingle()` — narrow parent-title lookup. */
export async function selectTitleById(
  client: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("tasks")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TaskTitleRow | null)?.title ?? null;
}

/** `select(TASK_RELATED_AND_PARENT_FIELDS) .eq("id", id) .maybeSingle()` — mutation pre-check. */
export async function selectRelatedAndParentById(
  client: SupabaseClient,
  id: string,
): Promise<TaskRelatedAndParentRow | null> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_RELATED_AND_PARENT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TaskRelatedAndParentRow | null) ?? null;
}

/**
 * `select(TASK_RELATED_LIST_FIELDS) .eq(related_schema/table/id) .is("parent_task_id", null)
 *   .order("created_at" desc) .limit(limit)` — record-related card.
 */
export async function selectRootsForRelatedRecord(
  client: SupabaseClient,
  args: { relatedSchema: string; relatedTable: string; relatedId: string; limit: number },
): Promise<TaskRelatedListRow[]> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_RELATED_LIST_FIELDS)
    .eq("related_schema", args.relatedSchema)
    .eq("related_table", args.relatedTable)
    .eq("related_id", args.relatedId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRelatedListRow[];
}

/**
 * `select(TASK_ROOT_LIST_FIELDS) .is("parent_task_id", null) [.eq("status", status)]
 *   .order("created_at" desc) .range(from, to)` — list-page rows.
 */
export async function selectRootsPaginated(
  client: SupabaseClient,
  args: { from: number; to: number; status?: string | null },
): Promise<TaskRootListRow[]> {
  let q = client
    .from("tasks")
    .select(TASK_ROOT_LIST_FIELDS)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .range(args.from, args.to);
  if (args.status) {
    q = q.eq("status", args.status);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRootListRow[];
}

/**
 * `select("*", { count: "exact", head: true }) .is("parent_task_id", null) [.eq("status", status)]`
 * — list-page total.
 */
export async function countRoots(
  client: SupabaseClient,
  args: { status?: string | null } = {},
): Promise<number> {
  let q = client
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .is("parent_task_id", null);
  if (args.status) {
    q = q.eq("status", args.status);
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * `select(TASK_RELATED_LIST_FIELDS) .eq("parent_task_id", parentId) .order("created_at" desc) [.limit(limit)]`
 * — subtasks list (`[id]/tasks/page.tsx`) and sidebar preview (`[id]/page.tsx`).
 */
export async function selectSubtasksByParentId(
  client: SupabaseClient,
  args: { parentId: string; limit?: number },
): Promise<TaskRelatedListRow[]> {
  let q = client
    .from("tasks")
    .select(TASK_RELATED_LIST_FIELDS)
    .eq("parent_task_id", args.parentId)
    .order("created_at", { ascending: false });
  if (args.limit != null) {
    q = q.limit(args.limit);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRelatedListRow[];
}

/**
 * `select("id") .eq(related_schema/table/id) .eq("status", "open") .eq("job_identifier", jobIdentifier)
 *   [.eq("task_type", taskType)] .maybeSingle()` — open skip/duplicate task probe.
 */
export async function selectOpenIdForRelatedJob(
  client: SupabaseClient,
  args: {
    relatedSchema: string;
    relatedTable: string;
    relatedId: string;
    jobIdentifier: string;
    taskType?: string;
  },
): Promise<TaskIdRow | null> {
  let q = client
    .from("tasks")
    .select("id")
    .eq("related_schema", args.relatedSchema)
    .eq("related_table", args.relatedTable)
    .eq("related_id", args.relatedId)
    .eq("status", "open")
    .eq("job_identifier", args.jobIdentifier);
  if (args.taskType != null) {
    q = q.eq("task_type", args.taskType);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TaskIdRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `insert(row)` — single-row insert (UNIQUE-violation `23505` surfaces via the returned error). */
export async function insertOne(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ code?: string; message: string } | null> {
  const { error } = await client.from("tasks").insert(row);
  if (!error) return null;
  return { code: error.code, message: error.message };
}

/** `update(patch) .eq("id", id) .select("id")` — returns affected ids (empty when nothing matched). */
export async function updateByIdReturningIds(
  client: SupabaseClient,
  args: { id: string; patch: Record<string, unknown> },
): Promise<TaskIdRow[]> {
  const { data, error } = await client
    .from("tasks")
    .update(args.patch)
    .eq("id", args.id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskIdRow[];
}

/** `delete() .eq("id", id) .select("id")` — returns affected ids (empty when nothing matched). */
export async function deleteByIdReturningIds(
  client: SupabaseClient,
  id: string,
): Promise<TaskIdRow[]> {
  const { data, error } = await client
    .from("tasks")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskIdRow[];
}
