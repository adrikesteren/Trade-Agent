import "server-only";

import { randomUUID } from "crypto";

import { BitvavoAdapter as BitvavoCandlesAdapter, type Candle } from "@/lib/bitvavo/public/candles";
import { fetchBitvavoOrder } from "@/lib/bitvavo/private/fetch-bitvavo-order";
import {
  placeBitvavoMarketBuyQuote,
  placeBitvavoMarketSellAmount,
} from "@/lib/bitvavo/private/place-market-order";
import {
  bitvavoCredentialsFromExchangeApiFields,
  type BitvavoExchangeCredentials,
} from "@/lib/bitvavo/private/signed-request";

import type {
  ExchangeCandle,
  ExchangeCredentials,
  ExchangeOrderPlacement,
  IExchangeAdapter,
} from "./exchange-adapter";

/** Translates normalized `ExchangeCredentials` to Bitvavo's native key/secret shape. */
function toBitvavoCredentials(creds: ExchangeCredentials): BitvavoExchangeCredentials {
  return { accessKey: creds.apiKey, privateKey: creds.apiSecret };
}

function mapCandle(c: Candle): ExchangeCandle {
  return {
    openTime: c.openTime,
    closeTime: c.closeTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    timeframe: c.timeframe,
  };
}

/**
 * Best-effort extraction of normalized order fields from a Bitvavo `/v2/order` payload.
 * Bitvavo returns strings for numeric fields, so we coerce with `Number(...)`.
 */
function mapOrderPayload(orderId: string, status: string, raw: Record<string, unknown>): ExchangeOrderPlacement {
  const filledQuantity = Number(raw.filledAmount);
  const filledQuote = Number(raw.filledAmountQuote);
  const priceCandidate = raw.price ?? raw.averagePrice;
  const priceNum = Number(priceCandidate);
  const averagePrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null;
  return {
    id: orderId,
    status,
    filledQuantity: Number.isFinite(filledQuantity) ? filledQuantity : 0,
    filledQuote: Number.isFinite(filledQuote) ? filledQuote : 0,
    averagePrice,
    raw,
  };
}

const bitvavoCandlesClient = new BitvavoCandlesAdapter();

/** Adapter that delegates to the existing `@/lib/bitvavo/*` helpers. */
export const bitvavoAdapter: IExchangeAdapter = {
  exchangeCode: "bitvavo",

  async retrieveCandles({ marketSymbol, timeframe, limit, endTimeMs }) {
    const candles = await bitvavoCandlesClient.listCandles({
      symbol: marketSymbol,
      timeframe,
      limit,
      // Underlying adapter expects an ISO string for `endTime`; convert from ms.
      endTime: endTimeMs ? new Date(endTimeMs).toISOString() : undefined,
    });
    return candles.map(mapCandle);
  },

  async placeMarketBuy({ credentials, marketSymbol, quoteAmount }) {
    const result = await placeBitvavoMarketBuyQuote({
      credentials: toBitvavoCredentials(credentials),
      market: marketSymbol,
      amountQuoteEur: quoteAmount,
      clientOrderId: randomUUID(),
    });
    return mapOrderPayload(result.orderId, result.status, result.raw);
  },

  async placeMarketSell({ credentials, marketSymbol, baseAmount }) {
    const result = await placeBitvavoMarketSellAmount({
      credentials: toBitvavoCredentials(credentials),
      market: marketSymbol,
      amountBase: baseAmount,
      clientOrderId: randomUUID(),
    });
    return mapOrderPayload(result.orderId, result.status, result.raw);
  },

  async fetchOrder({ credentials, marketSymbol, orderId }) {
    const snapshot = await fetchBitvavoOrder({
      credentials: toBitvavoCredentials(credentials),
      market: marketSymbol,
      orderId,
    });
    if (!snapshot) {
      throw new Error(`Bitvavo order not found: market=${marketSymbol} orderId=${orderId}`);
    }
    return mapOrderPayload(snapshot.orderId, snapshot.status, snapshot.raw);
  },

  credentialsFromExchangeApiFields(apiKey, apiSecret) {
    const bitvavo = bitvavoCredentialsFromExchangeApiFields(apiKey, apiSecret);
    if (!bitvavo) return null;
    return { apiKey: bitvavo.accessKey, apiSecret: bitvavo.privateKey };
  },
};
