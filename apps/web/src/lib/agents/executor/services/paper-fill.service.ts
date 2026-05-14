/** Base quantity from EUR notional and last trade price (quote per 1 base). */
export function baseQuantityFromNotionalEur(notionalEur: number, priceQuotePerBase: number): number {
  if (!Number.isFinite(notionalEur) || notionalEur <= 0) return 0;
  if (!Number.isFinite(priceQuotePerBase) || priceQuotePerBase <= 0) return 0;
  return notionalEur / priceQuotePerBase;
}

/** Weighted average entry after adding `addQty` at `addPrice` to existing position. */
export function mergeBuyPositionAvg(args: {
  existingQty: number;
  existingAvg: number | null;
  addQty: number;
  addPrice: number;
}): { quantity: number; avgPrice: number } {
  const { existingQty, existingAvg, addQty, addPrice } = args;
  const oldQty = Math.max(0, existingQty);
  const oldAvg = existingAvg != null && Number.isFinite(existingAvg) ? existingAvg : 0;
  const newQty = oldQty + addQty;
  if (newQty <= 0) return { quantity: 0, avgPrice: 0 };
  if (oldQty <= 0) return { quantity: newQty, avgPrice: addPrice };
  const numer = oldQty * oldAvg + addQty * addPrice;
  return { quantity: newQty, avgPrice: numer / newQty };
}
