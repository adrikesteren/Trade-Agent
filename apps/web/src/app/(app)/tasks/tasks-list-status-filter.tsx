"use client";

import { buildListPageHref } from "@/lib/dashboard/list-pagination";
import {
  TASK_LIST_STATUS_QUERY_ALL,
  TASK_LIST_STATUS_DEFAULT,
  type TaskListStatusFilter,
} from "@/lib/tasks/task-list-status";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

const SELECT_VALUE_ALL = "__all__";

export type TasksListStatusFilterProps = {
  /** Distinct statuses from the DB (merged with canonical set on the server). */
  statusOptions: { value: string; label: string }[];
  filter: TaskListStatusFilter;
};

export function TasksListStatusFilter({ statusOptions, filter }: TasksListStatusFilterProps) {
  const router = useRouter();

  const selectValue = useMemo(() => {
    if (filter.mode === "all") return SELECT_VALUE_ALL;
    return filter.status;
  }, [filter]);

  const options = useMemo(
    () => [{ value: SELECT_VALUE_ALL, label: "All" }, ...statusOptions],
    [statusOptions],
  );

  return (
    <label className="flex flex-wrap items-center gap-2 text-xs">
      <span className="bk-text-muted shrink-0">Status</span>
      <select
        className="min-w-[10rem] rounded border border-[var(--bk-border)] bg-[var(--bk-surface-1)] px-2 py-1 font-medium text-[var(--text)]"
        value={options.some((o) => o.value === selectValue) ? selectValue : TASK_LIST_STATUS_DEFAULT}
        onChange={(e) => {
          const v = e.target.value;
          if (v === SELECT_VALUE_ALL) {
            router.push(buildListPageHref("/tasks", 1, { status: TASK_LIST_STATUS_QUERY_ALL }));
            return;
          }
          if (v === TASK_LIST_STATUS_DEFAULT) {
            router.push("/tasks");
            return;
          }
          router.push(buildListPageHref("/tasks", 1, { status: v }));
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
