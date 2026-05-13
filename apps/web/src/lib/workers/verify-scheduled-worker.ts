import { resolveWorkerCronSecret } from "@/lib/workers/resolve-worker-cron-secret";

/**
 * True when the request carries `Authorization: Bearer` matching the configured worker secret
 * (`public.system_settings` key `cron_secret`, then `CRON_SECRET` env). See {@link resolveWorkerCronSecret}.
 */
export async function verifyScheduledWorker(request: Request, rawBody: string): Promise<boolean> {
  void rawBody;
  const secret = await resolveWorkerCronSecret();
  const auth = request.headers.get("authorization")?.trim();
  if (!secret || !auth) return false;
  return auth === `Bearer ${secret}`;
}
