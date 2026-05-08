import { verifyQStashRequest } from "@/lib/qstash";

/**
 * True if the request is from QStash (signed) or from a trusted cron caller (Bearer CRON_SECRET).
 */
export async function verifyScheduledWorker(request: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) {
    return true;
  }
  return verifyQStashRequest(request, rawBody);
}
