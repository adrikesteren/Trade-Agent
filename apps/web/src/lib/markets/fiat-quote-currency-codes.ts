/**
 * ISO 4217-style fiat symbols we seed as `catalog.assets` (`kind = fiat`).
 * Used to resolve Bitvavo quote text: these map to fiat rows; anything else maps to `crypto` by code.
 *
 * Keep in sync with:
 * - supabase/migrations/20260701100000_catalog_fiat_assets_and_markets_quote_asset.sql
 * - supabase/migrations/20260701101000_quote_asset_sql_functions.sql (`catalog.resolve_quote_asset_id_by_code`)
 */
export const FIAT_QUOTE_CURRENCY_CODES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "NOK",
  "SEK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ISK",
  "TRY",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "NZD",
  "SGD",
  "HKD",
  "MXN",
  "ZAR",
  "ILS",
  "INR",
  "KRW",
  "THB",
  "PHP",
  "IDR",
  "MYR",
] as const;

const FIAT_SET = new Set<string>(FIAT_QUOTE_CURRENCY_CODES);

export function isFiatQuoteCurrencyCode(code: string): boolean {
  return FIAT_SET.has(String(code).trim().toUpperCase());
}
