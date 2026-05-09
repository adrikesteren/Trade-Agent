/** Map Bitvavo REST `order.status` to `trading.order_status` (aligned with executor live path). */
export function mapBitvavoOrderStatusToDb(
  s: string,
): "pending" | "open" | "filled" | "cancelled" | "rejected" {
  if (s === "filled") return "filled";
  if (s === "new" || s === "partiallyFilled") return "open";
  if (s === "canceled" || s === "cancelled" || s === "expired") return "cancelled";
  return "open";
}
