/** Values accepted by `updateTaskDetails` / task edit UI. */
export const DASHBOARD_TASK_EDITABLE_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;

export type DashboardTaskEditableStatus = (typeof DASHBOARD_TASK_EDITABLE_STATUSES)[number];

const EDITABLE_SET = new Set<string>(DASHBOARD_TASK_EDITABLE_STATUSES);

export function isDashboardTaskEditableStatus(s: string): boolean {
  return EDITABLE_SET.has(s);
}

export function labelDashboardTaskStatus(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
