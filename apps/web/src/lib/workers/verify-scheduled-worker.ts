/**
 * True when the request carries `Authorization: Bearer ${CRON_SECRET}`.
 * Workers are invoked manually (dashboard, curl) or by your own scheduler hitting these routes.
 */
export async function verifyScheduledWorker(request: Request, rawBody: string): Promise<boolean> {
  void rawBody;
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  return Boolean(secret && auth === `Bearer ${secret}`);
}
