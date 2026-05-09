import "server-only";

import { bitvavoPrivatePost } from "./signed-request";

const ORDER_PATH = "/v2/order";

export type BitvavoPlaceMarketBuyQuoteResult = {
  orderId: string;
  status: string;
  raw: Record<string, unknown>;
};

function operatorIdFromEnv(): number {
  const n = Number(process.env.BITVAVO_OPERATOR_ID ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 2_147_483_647);
}

/** Market buy spending a fixed quote (EUR) amount. */
export async function placeBitvavoMarketBuyQuote(params: {
  market: string;
  amountQuoteEur: number;
  clientOrderId: string;
}): Promise<BitvavoPlaceMarketBuyQuoteResult> {
  const amountQuote = params.amountQuoteEur.toFixed(2);
  const res = await bitvavoPrivatePost(ORDER_PATH, {
    market: params.market.toUpperCase(),
    side: "buy",
    orderType: "market",
    operatorId: operatorIdFromEnv(),
    clientOrderId: params.clientOrderId,
    amountQuote,
    responseRequired: true,
  });

  const text = await res.text();
  let raw: Record<string, unknown> = {};
  try {
    raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    raw = { parseError: text };
  }

  if (!res.ok) {
    throw new Error(`Bitvavo order failed: HTTP ${res.status} ${text}`);
  }

  const orderId = typeof raw.orderId === "string" ? raw.orderId : "";
  if (!orderId) {
    throw new Error(`Bitvavo order: missing orderId in response: ${text}`);
  }

  const status = typeof raw.status === "string" ? raw.status : "unknown";
  return { orderId, status, raw };
}
