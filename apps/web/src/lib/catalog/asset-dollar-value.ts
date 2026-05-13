/**
 * Wallet / UI valuation: all assets expose `dollar_value` = USD per 1 unit (USD fiat = 1).
 * User primary fiat `P` uses `primaryDollarValue` = USD per 1 P.
 *
 * `primaryValue = (quantity * fromDollarValue) / primaryDollarValue`
 * When primary is USD, `primaryDollarValue` is 1 so result equals USD notional.
 */
export function valueInPrimaryUnits(args: {
  quantity: number;
  fromDollarValue: number | null | undefined;
  primaryDollarValue: number | null | undefined;
  /** Uppercase ISO, e.g. "USD" — when USD, divide step is skipped (divide by 1). */
  primaryAssetCode: string;
}): number | null {
  const q = args.quantity;
  const fromDv = args.fromDollarValue;
  const primDv = args.primaryDollarValue;
  const code = String(args.primaryAssetCode ?? "").trim().toUpperCase();

  if (!Number.isFinite(q)) return null;
  if (fromDv == null || !Number.isFinite(fromDv) || fromDv <= 0) return null;

  const usd = q * fromDv;
  if (!Number.isFinite(usd)) return null;

  if (code === "USD") {
    return usd;
  }

  if (primDv == null || !Number.isFinite(primDv) || primDv <= 0) return null;
  const out = usd / primDv;
  return Number.isFinite(out) ? out : null;
}
