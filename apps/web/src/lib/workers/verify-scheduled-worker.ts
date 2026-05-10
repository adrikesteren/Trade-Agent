import { verifyQStashRequest } from "@/lib/qstash";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay (ms) after a successful QStash signature check, before worker body runs,
 * only for deliveries from a **schedule** (`Upstash-Schedule-Id` header — not self-queued chunk POSTs).
 * Gives DB / clock edge a moment to settle when cron hits right on the boundary.
 * Set `QSTASH_SCHEDULE_START_DELAY_MS=0` to disable. Default 5000.
 */
function qstashScheduleStartDelayMs(): number {
  const raw = process.env.QSTASH_SCHEDULE_START_DELAY_MS?.trim();
  if (raw === "0" || raw === "") return 0;
  if (raw == null) return 5000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5000;
  return Math.min(Math.floor(n), 120_000);
}

/**
 * True if the request is from QStash (signed) or from a trusted cron caller (Bearer CRON_SECRET).
 * Schedule-triggered QStash deliveries (`Upstash-Schedule-Id`) wait `QSTASH_SCHEDULE_START_DELAY_MS`
 * (default 5s) before returning true, so worker logic runs after the schedule instant.
 * Self-published continuations (same verify, no schedule header) do not wait.
 */
export async function verifyScheduledWorker(request: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) {
    return true;
  }
  const ok = await verifyQStashRequest(request, rawBody);
  if (!ok) {
    return false;
  }
  const scheduleId = request.headers.get("Upstash-Schedule-Id")?.trim();
  const delayMs = scheduleId ? qstashScheduleStartDelayMs() : 0;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  return true;
}
