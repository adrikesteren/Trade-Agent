import "server-only";

import type { Schedule } from "@upstash/qstash";

import { createQstashClient } from "@/lib/qstash/qstash-client";

export async function listQstashSchedules(): Promise<Schedule[]> {
  const client = createQstashClient();
  return client.schedules.list();
}
