/**
 * P3 — pure ATR-based volatility gate.
 *
 * Used by the deterministic signal eval services to skip bars where the
 * market is either too dead (chop / flat) or too wild (news / liquidation
 * cascades). Both extremes are typically loss-making for the trend / mean-
 * reversion / breakout playbooks, so we filter them out before the agent
 * even gets to evaluate.
 *
 * The gate is expressed as a percentage of price (`ATR / price`) so it is
 * dimensionally comparable across BTC and small caps.
 *
 * This is a **pure helper** (no I/O), per [`service-folders.mdc`](.cursor/rules/service-folders.mdc):
 * volatility filtering is a stateless math step on a few numbers, not a
 * service that coordinates Supabase / agents.
 */

export type VolatilityGateInput = {
  /** Average True Range in price units (e.g. EUR per BTC). */
  atr: number;
  /** Reference close price in the same units. */
  price: number;
  /** Inclusive lower bound on `atr/price` expressed as a fraction (e.g. 0.002 = 0.2%). */
  minAtrPct?: number | null;
  /** Inclusive upper bound on `atr/price` expressed as a fraction (e.g. 0.10 = 10%). */
  maxAtrPct?: number | null;
};

export type VolatilityGateResult = {
  /** True when the bar's volatility falls within the configured window. */
  pass: boolean;
  /** The computed `atr/price` ratio (NaN when inputs are not finite or price is non-positive). */
  atrPct: number;
  /** Human-readable reason; empty string when `pass` is true. */
  reason: "low_volatility" | "high_volatility" | "invalid_inputs" | "";
};

/**
 * Returns `{ pass: true }` when:
 * - `atr` and `price` are finite and `price > 0`, and
 * - `atr/price` is `>= minAtrPct` (when set), and
 * - `atr/price` is `<= maxAtrPct` (when set).
 *
 * Otherwise returns `{ pass: false, reason }` with one of:
 * - `"invalid_inputs"` — non-finite numbers or non-positive price.
 * - `"low_volatility"` — the market is too quiet.
 * - `"high_volatility"` — the market is too wild.
 */
export function passesVolatilityGate(input: VolatilityGateInput): VolatilityGateResult {
  const { atr, price, minAtrPct, maxAtrPct } = input;
  if (!Number.isFinite(atr) || !Number.isFinite(price) || price <= 0) {
    return { pass: false, atrPct: Number.NaN, reason: "invalid_inputs" };
  }
  const atrPct = atr / price;
  if (typeof minAtrPct === "number" && Number.isFinite(minAtrPct) && atrPct < minAtrPct) {
    return { pass: false, atrPct, reason: "low_volatility" };
  }
  if (typeof maxAtrPct === "number" && Number.isFinite(maxAtrPct) && atrPct > maxAtrPct) {
    return { pass: false, atrPct, reason: "high_volatility" };
  }
  return { pass: true, atrPct, reason: "" };
}
