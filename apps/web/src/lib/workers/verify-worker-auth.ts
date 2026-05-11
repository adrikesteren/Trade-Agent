import "server-only";

import { Receiver } from "@upstash/qstash";

import { verifyScheduledWorker } from "@/lib/workers/verify-scheduled-worker";

/**
 * Workers that may be called by QStash or by cron with `CRON_SECRET`.
 * If `QSTASH_CURRENT_SIGNING_KEY` is set and `Upstash-Signature` is present, verify that first.
 * Otherwise fall back to Bearer `CRON_SECRET` (see `verifyScheduledWorker`).
 */
export async function verifyWorkerAuth(request: Request, rawBody: string): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const sig =
    request.headers.get("Upstash-Signature")?.trim() ?? request.headers.get("upstash-signature")?.trim() ?? "";

  if (current && sig) {
    const next = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
    const receiver = new Receiver({
      currentSigningKey: current,
      ...(next ? { nextSigningKey: next } : {}),
    });
    try {
      const base = process.env.APP_URL?.trim().replace(/\/$/, "");
      const path = new URL(request.url).pathname + new URL(request.url).search;
      const urlForVerify = base ? `${base}${path}` : undefined;
      const verified = await receiver.verify({
        signature: sig,
        body: rawBody,
        ...(urlForVerify ? { url: urlForVerify } : {}),
      });
      if (verified) return true;
    } catch {
      /* fall through to Bearer */
    }
  }

  return verifyScheduledWorker(request, rawBody);
}
