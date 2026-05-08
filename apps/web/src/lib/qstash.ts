import { Receiver } from "@upstash/qstash";

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
    const isValid = await receiver.verify({
      signature,
      body: bodyText,
      url: request.url,
    });
    return isValid;
  } catch {
    return false;
  }
}
