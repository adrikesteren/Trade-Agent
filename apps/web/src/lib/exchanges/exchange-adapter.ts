import "server-only";

/** Normalized OHLCV bar emitted by adapters. Times are ISO strings (UTC). */
export type ExchangeCandle = {
  /** Bar open timestamp (ISO 8601, UTC). */
  openTime: string;
  /** Bar close timestamp (ISO 8601, UTC). */
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Echoes the requested timeframe (e.g. "1m", "15m", "1h"). */
  timeframe: string;
};

/** Normalized order placement / lookup result. */
export type ExchangeOrderPlacement = {
  /** External (exchange-side) order id. */
  id: string;
  /** Exchange-native status string, lower-cased by the adapter when possible. */
  status: string;
  /** Filled quantity in base asset. NaN/missing when not yet known. */
  filledQuantity: number;
  /** Filled quote amount (price * qty). NaN/missing when not yet known. */
  filledQuote: number;
  /** Average fill price; null when not derivable from the response. */
  averagePrice: number | null;
  /** Exchange-native payload, retained for debugging / persistence. */
  raw: unknown;
};

/** Normalized credentials passed to adapter operations. */
export type ExchangeCredentials = {
  apiKey: string;
  apiSecret: string;
};

/**
 * Adapter contract — all exchange-specific HTTP/SDK calls live behind this interface.
 * Implementations are registered in the module-level registry (see `exchange-adapter-registry.ts`).
 */
export interface IExchangeAdapter {
  /** Stable lowercase code (e.g. "bitvavo"). */
  readonly exchangeCode: string;

  /**
   * Fetch up to `limit` recent candles ending at `endTimeMs` (inclusive, optional).
   * Implementations MUST return candles ordered oldest-first.
   */
  retrieveCandles(args: {
    marketSymbol: string;
    timeframe: string;
    limit: number;
    endTimeMs?: number;
  }): Promise<ExchangeCandle[]>;

  /** Market buy spending a fixed quote-asset amount (e.g. EUR). */
  placeMarketBuy(args: {
    credentials: ExchangeCredentials;
    marketSymbol: string;
    quoteAmount: number;
  }): Promise<ExchangeOrderPlacement>;

  /** Market sell of a fixed base-asset amount. */
  placeMarketSell(args: {
    credentials: ExchangeCredentials;
    marketSymbol: string;
    baseAmount: number;
  }): Promise<ExchangeOrderPlacement>;

  /** Lookup an order by its exchange-side id. */
  fetchOrder(args: {
    credentials: ExchangeCredentials;
    marketSymbol: string;
    orderId: string;
  }): Promise<ExchangeOrderPlacement>;

  /**
   * Build normalized credentials from raw executor fields. Returns `null` when either
   * key is missing/blank so callers can short-circuit without throwing.
   */
  credentialsFromExchangeApiFields(
    apiKey: string | null | undefined,
    apiSecret: string | null | undefined,
  ): ExchangeCredentials | null;
}
