/**
 * Inverse of {@link valueInPrimaryUnits}: convert a notional expressed in the user's primary fiat
 * (e.g. USD, EUR) into the market's quote-asset units, using `catalog.assets.dollar_value`
 * (USD per 1 unit).
 *
 * Formula:
 *   primaryAmount [primary]
 *     × primaryDollarValue [USD/primary]
 *     ÷ quoteDollarValue   [USD/quote]
 *   = result [quote]
 *
 * If primary OR quote dollar values are missing/non-positive, returns `null` (caller decides
 * whether to fall back or skip). The mediator skips the executor + market combo with
 * reason `quote_asset_not_allowed` when this returns null.
 */
export function primaryUnitsToQuoteUnits(args: {
  /** Notional in the owner's primary fiat units. */
  primaryAmount: number;
  /** USD per 1 primary unit (catalog.assets.dollar_value of the primary fiat). */
  primaryDollarValue: number | null | undefined;
  /** USD per 1 quote unit (catalog.assets.dollar_value of the quote asset). */
  quoteDollarValue: number | null | undefined;
}): number | null {
  const p = args.primaryAmount;
  const pdv = args.primaryDollarValue;
  const qdv = args.quoteDollarValue;

  if (!Number.isFinite(p) || p <= 0) return null;
  if (pdv == null || !Number.isFinite(pdv) || pdv <= 0) return null;
  if (qdv == null || !Number.isFinite(qdv) || qdv <= 0) return null;

  const usd = p * pdv;
  if (!Number.isFinite(usd)) return null;

  const out = usd / qdv;
  return Number.isFinite(out) && out > 0 ? out : null;
}
