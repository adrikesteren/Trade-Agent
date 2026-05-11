import "server-only";

import { createHmac } from "crypto";

import { BITVAVO_REST_ORIGIN } from "@/lib/bitvavo/constants";

/** Bitvavo REST signing credentials (maps to executor `exchange_api_key` / `exchange_api_secret`). */
export type BitvavoExchangeCredentials = {
  accessKey: string;
  privateKey: string;
};

/** Returns credentials only when both trimmed strings are non-empty. */
export function bitvavoCredentialsFromExchangeApiFields(
  exchangeApiKey: string | null | undefined,
  exchangeApiSecret: string | null | undefined,
): BitvavoExchangeCredentials | null {
  const accessKey = String(exchangeApiKey ?? "").trim();
  const privateKey = String(exchangeApiSecret ?? "").trim();
  if (!accessKey || !privateKey) return null;
  return { accessKey, privateKey };
}

export function bitvavoSign(secret: string, timestamp: number, method: string, requestPath: string, body: string): string {
  const msg = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return createHmac("sha256", secret).update(msg).digest("hex");
}

/**
 * POST to a Bitvavo private path (e.g. `/v2/order`). `requestPath` must match the path used in the signature.
 */
export async function bitvavoPrivatePost(
  creds: BitvavoExchangeCredentials,
  requestPath: string,
  bodyObj: Record<string, unknown>,
): Promise<Response> {
  const body = JSON.stringify(bodyObj);
  const timestamp = Date.now();
  const sig = bitvavoSign(creds.privateKey, timestamp, "POST", requestPath, body);

  return fetch(`${BITVAVO_REST_ORIGIN}${requestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Bitvavo-Access-Key": creds.accessKey,
      "Bitvavo-Access-Signature": sig,
      "Bitvavo-Access-Timestamp": String(timestamp),
    },
    body,
  });
}

/**
 * GET with signed path. `requestPath` must be the path **including** query string as used in the URL
 * (e.g. `/v2/order?market=BTC-EUR&orderId=...`), matching Bitvavo signing rules.
 */
export async function bitvavoPrivateGet(creds: BitvavoExchangeCredentials, requestPath: string): Promise<Response> {
  const body = "";
  const timestamp = Date.now();
  const sig = bitvavoSign(creds.privateKey, timestamp, "GET", requestPath, body);

  return fetch(`${BITVAVO_REST_ORIGIN}${requestPath}`, {
    method: "GET",
    headers: {
      "Bitvavo-Access-Key": creds.accessKey,
      "Bitvavo-Access-Signature": sig,
      "Bitvavo-Access-Timestamp": String(timestamp),
    },
  });
}
