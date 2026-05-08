import { Receiver } from "@upstash/qstash";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

/**
 * QStash signs the callback URL it POSTs to. That must match what we pass to `Receiver.verify`.
 * When the app sees `http://localhost:3000/...` but QStash was told to use `APP_BASE_URL` (e.g. ngrok),
 * `request.url` alone would fail verification — use the same public origin as publishing.
 */
function qstashSigningUrl(request: Request): string {
  const base = workerPublicBaseUrl();
  if (!base) return request.url;
  const { pathname, search } = new URL(request.url);
  return `${base}${pathname}${search}`;
}

/**
 * Verifies QStash `Upstash-Signature` on the raw body string.
 * Set `ALLOW_INSECURE_QSTASH=1` only for local development without signing keys.
 */
export async function verifyQStashRequest(
  request: Request,
  bodyText: string,
): Promise<boolean> {
  if (process.env.ALLOW_INSECURE_QSTASH === "1") {
    return true;
  }
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) {
    return false;
  }
  const receiver = new Receiver({
    currentSigningKey: current,
    nextSigningKey: next,
  });
  const signature = request.headers.get("Upstash-Signature");
  if (!signature) return false;
  try {
    const url = qstashSigningUrl(request);
    const isValid = await receiver.verify({
      signature,
      body: bodyText,
      url,
    });
    return isValid;
  } catch {
    return false;
  }
}
