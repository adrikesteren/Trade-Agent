/** Row shape for GET `/api/dashboard/upstash/schedules` (shared with dashboard UI). */
export type UpstashScheduleListRow = {
  scheduleId: string;
  /** QStash schedule label when set; otherwise null. */
  label: string | null;
  /** Human-friendly name for the table (label or schedule id). */
  displayName: string;
  destination: string;
  path: string;
  cron: string | null;
  isPaused: boolean;
  managed: boolean;
};
