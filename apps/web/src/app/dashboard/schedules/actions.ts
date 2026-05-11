"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createQstashClient } from "@/lib/qstash/qstash-client";
import { createClient } from "@/lib/supabase/server";

export type SetQstashSchedulePausedResult = { ok: true } | { ok: false; error: string };

/**
 * `nextPaused` is the new `isPaused` flag in QStash (true = deliveries stopped until resume).
 */
export async function setQstashSchedulePausedState(
  scheduleId: string,
  nextPaused: boolean,
): Promise<SetQstashSchedulePausedResult> {
  const id = scheduleId.trim();
  if (!id) return { ok: false, error: "Missing schedule id." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const client = createQstashClient();
    if (nextPaused) {
      await client.schedules.pause({ schedule: id });
    } else {
      await client.schedules.resume({ schedule: id });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  revalidatePath("/dashboard/schedules");
  return { ok: true };
}
