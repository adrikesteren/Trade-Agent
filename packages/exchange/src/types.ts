/** Normalized OHLCV candle (closed bar). */
export type Candle = {
  exchange: string;
  symbol: string;
  timeframe: string;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ListCandlesParams = {
  symbol: string;
  timeframe: string;
  /** Max candles to return, newest last (Bitvavo returns oldest-first; adapter may reverse). */
  limit?: number;
  endTime?: string;
};

export interface ExchangeAdapter {
  readonly exchangeId: string;
  listCandles(params: ListCandlesParams): Promise<Candle[]>;
}
