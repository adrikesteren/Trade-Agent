import "server-only";

import { createHmac } from "crypto";

const BASE = "https://api.bitvavo.com";

export function bitvavoSign(secret: string, timestamp: number, method: string, requestPath: string, body: string): string {
  const msg = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return createHmac("sha256", secret).update(msg).digest("hex");
}

export function bitvavoPrivateEnv(): { key: string; secret: string } {
  const key = process.env.BITVAVO_API_KEY?.trim();
  const secret = process.env.BITVAVO_API_SECRET?.trim();
  if (!key || !secret) {
    throw new Error("BITVAVO_API_KEY and BITVAVO_API_SECRET must be set for live Bitvavo orders");
  }
  return { key, secret };
}

/**
 * POST to a Bitvavo private path (e.g. `/v2/order`). `requestPath` must match the path used in the signature.
 */
export async function bitvavoPrivatePost(requestPath: string, bodyObj: Record<string, unknown>): Promise<Response> {
  const { key, secret } = bitvavoPrivateEnv();
  const body = JSON.stringify(bodyObj);
  const timestamp = Date.now();
  const sig = bitvavoSign(secret, timestamp, "POST", requestPath, body);

  return fetch(`${BASE}${requestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Bitvavo-Access-Key": key,
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
export async function bitvavoPrivateGet(requestPath: string): Promise<Response> {
  const { key, secret } = bitvavoPrivateEnv();
  const body = "";
  const timestamp = Date.now();
  const sig = bitvavoSign(secret, timestamp, "GET", requestPath, body);

  return fetch(`${BASE}${requestPath}`, {
    method: "GET",
    headers: {
      "Bitvavo-Access-Key": key,
      "Bitvavo-Access-Signature": sig,
      "Bitvavo-Access-Timestamp": String(timestamp),
    },
  });
}
