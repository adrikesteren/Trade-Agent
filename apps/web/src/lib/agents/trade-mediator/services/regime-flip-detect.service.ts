/**
 * P3 — pure regime-flip detection.
 *
 * Reads the regime label from the latest 3 regime-classifier signals
 * (`t-2`, `t-1`, `t` ordered by close time) and decides whether a confirmed
 * flip happened.
 *
 * "Confirmed flip" = the previous bar (`t-1`) flipped to a new directional
 * regime (bull/bear) AND the current bar (`t`) holds that new regime.
 * Concretely:
 *   `regime(t-2) != regime(t-1) == regime(t)` AND
 *   `regime(t-1) ∈ {bull, bear}` (sideways flips are no-ops).
 *
 * Pre-P3 mediator never inspected the previous regime; SAR (Stop-and-Reverse)
 * lives or dies on this confirmation rule. Without confirmation, regime
 * whipsaws would generate a flood of EXIT/ENTER pairs and burn fees.
 *
 * This helper is pure / synchronous — the mediator is responsible for
 * fetching the three signals and ordering them by `close_time` ascending.
 */

export type RegimeLabel = "bull" | "bear" | "sideways";

export type RegimePoint = {
  /**
   * Trading.signals close-time (or candle close time the regime classifier
   * was evaluated against). Used only for ordering / debugging — not for
   * the flip decision itself.
   */
  closeTimeIso: string;
  regime: RegimeLabel;
};

export type RegimeFlipResult = {
  flipped: boolean;
  fromRegime: RegimeLabel | null;
  toRegime: RegimeLabel | null;
  /** When `flipped`, the closeTimeIso of the bar that confirmed the flip (always `t`). */
  confirmedAtBar: string | null;
};

/**
 * @param ascending — three regime points in ascending close-time order:
 * `[t-2, t-1, t]`. Pass fewer points to indicate "not enough history yet"
 * (returns `flipped: false`).
 */
export function detectRegimeFlip(ascending: RegimePoint[]): RegimeFlipResult {
  if (!Array.isArray(ascending) || ascending.length < 3) {
    return { flipped: false, fromRegime: null, toRegime: null, confirmedAtBar: null };
  }
  const [tm2, tm1, t] = ascending.slice(-3);
  if (tm2.regime === tm1.regime) {
    return { flipped: false, fromRegime: null, toRegime: null, confirmedAtBar: null };
  }
  if (tm1.regime !== t.regime) {
    return { flipped: false, fromRegime: null, toRegime: null, confirmedAtBar: null };
  }
  if (tm1.regime === "sideways") {
    return { flipped: false, fromRegime: null, toRegime: null, confirmedAtBar: null };
  }
  return {
    flipped: true,
    fromRegime: tm2.regime,
    toRegime: tm1.regime,
    confirmedAtBar: t.closeTimeIso,
  };
}
