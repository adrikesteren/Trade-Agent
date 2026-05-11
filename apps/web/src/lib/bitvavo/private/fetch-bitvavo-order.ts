import "server-only";

import { bitvavoPrivateGet, type BitvavoExchangeCredentials } from "@/lib/bitvavo/private/signed-request";

export type BitvavoOrderSnapshot = {
  orderId: string;
  market: string;
  status: string;
  filledAmount: number;
  price: number;
  raw: Record<string, unknown>;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** GET /v2/order for a single open order id. */
export async function fetchBitvavoOrder(params: {
  credentials: BitvavoExchangeCredentials;
  market: string;
  orderId: string;
}): Promise<BitvavoOrderSnapshot | null> {
  const market = params.market.trim().toUpperCase();
  const orderId = params.orderId.trim();
  if (!market || !orderId) return null;

  const qs = new URLSearchParams({ market, orderId });
  const requestPath = `/v2/order?${qs.toString()}`;
  const res = await bitvavoPrivateGet(params.credentials, requestPath);
  const text = await res.text();
  let raw: Record<string, unknown> = {};
  try {
    raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    raw = { parseError: text };
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Bitvavo GET order failed: HTTP ${res.status} ${text}`);
  }

  const oid = typeof raw.orderId === "string" ? raw.orderId : orderId;
  const m = typeof raw.market === "string" ? raw.market : market;
  const status = typeof raw.status === "string" ? raw.status : "unknown";
  const filledAmount = num(raw.filledAmount);
  const price = num(raw.price);

  return {
    orderId: oid,
    market: m,
    status,
    filledAmount,
    price,
    raw,
  };
}
