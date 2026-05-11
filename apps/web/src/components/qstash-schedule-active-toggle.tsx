"use client";

import { setQstashSchedulePausedState } from "@/app/dashboard/schedules/actions";
import { Switch } from "@repo/blocks";
import { useState, useTransition } from "react";

type Props = {
  scheduleId: string;
  /** From QStash `Schedule.isPaused` */
  initiallyPaused: boolean;
};

export function QstashScheduleActiveToggle({ scheduleId, initiallyPaused }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-w-[3rem] flex-col items-start gap-0.5">
      <Switch
        checked={!initiallyPaused}
        disabled={pending}
        aria-label={initiallyPaused ? "Schedule paused; turn on to resume" : "Schedule active; turn off to pause"}
        onCheckedChange={(checked) => {
          setError(null);
          startTransition(async () => {
            const result = await setQstashSchedulePausedState(scheduleId, !checked);
            if (!result.ok) setError(result.error);
          });
        }}
      />
      {error ? (
        <span className="max-w-[140px] text-[10px] leading-tight text-red-600 dark:text-red-400" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
