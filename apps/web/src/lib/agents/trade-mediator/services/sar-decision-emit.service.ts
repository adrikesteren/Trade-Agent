/**
 * P3 — pure SAR (Stop-and-Reverse) decision emitter.
 *
 * Given a confirmed regime flip, the executor's `allowed_sides`, and any
 * existing open position, decide which paired EXIT + ENTER decisions the
 * mediator should write for this bar. Both decisions share the same
 * regime-classifier signal_id but use different `position_side` (allowed by
 * P3/M10's widened uniqueness on `trading.decisions`).
 *
 * Rules:
 * - `regimePreferredSide('bull') = 'long'`,
 *   `regimePreferredSide('bear') = 'short'`,
 *   `regimePreferredSide('sideways') = null` (no SAR action — caller should
 *   not invoke this helper for sideways flips).
 * - When an open position exists on the side **opposite** the new regime →
 *   emit EXIT for that side (full size).
 * - When the preferred side is in `allowedSides` AND no opposite-side
 *   position already exists → emit ENTER for the preferred side.
 * - Bitvavo (`allowed_sides=['long']`) on a confirmed bull→bear flip ⇢
 *   only EXIT long; the executor stays flat. Symmetric on bear→bull when
 *   short is not allowed.
 *
 * Pure / synchronous. The mediator owns Supabase I/O.
 */

import type { RegimeFlipResult } from "./regime-flip-detect.service";

export type PositionSide = "long" | "short";

export type SarOpenPosition = {
  side: PositionSide;
  /** Open quantity (base units). When zero / negative, treated as no position on that side. */
  quantity: number;
};

export type SarOrderProposal = {
  /** Trade direction; long-EXIT = sell, short-EXIT = buy-to-cover. */
  side: "buy" | "sell";
  positionSide: PositionSide;
  intent: "EXIT" | "ENTER";
  /** Quantity in base units (only set on EXIT). On ENTER the executor sizes via the quote-asset budget. */
  quantity?: number;
  /** Notional in quote units (only set on ENTER, when caller passed `notionalQuoteForEnter`). */
  notionalQuote?: number;
  reason: "sar_exit_old_side" | "sar_enter_new_side";
};

export type SarEmitResult = {
  /**
   * Up to two paired proposals. EXIT (when present) is always first so the
   * executor can settle wallet movements before the ENTER pre-flight runs.
   */
  proposals: SarOrderProposal[];
  /** Echoed back for audit / decision_payload.sarFlip. Includes "sideways" when caller invokes the helper for an unconfirmed flip — handled as no-op. */
  fromRegime: "bull" | "bear" | "sideways" | null;
  toRegime: "bull" | "bear" | "sideways" | null;
  /** Echoed back for audit. */
  confirmedAtBar: string | null;
  /** True when the new side is allowed by the executor (i.e. an ENTER proposal was emitted). */
  enterAllowed: boolean;
  /** Reason explaining why an ENTER was suppressed (when applicable). */
  enterSuppressedReason: "side_not_allowed" | "opposite_already_open" | "no_preferred_side" | null;
};

function regimePreferredSide(regime: "bull" | "bear" | "sideways" | null): PositionSide | null {
  if (regime === "bull") return "long";
  if (regime === "bear") return "short";
  return null;
}

export function emitSarDecisions(args: {
  flip: RegimeFlipResult;
  allowedSides: PositionSide[];
  openPositions: SarOpenPosition[];
  /** Optional notional in quote units to stamp on the ENTER proposal. */
  notionalQuoteForEnter?: number | null;
}): SarEmitResult {
  const { flip, allowedSides, openPositions, notionalQuoteForEnter } = args;
  const empty: SarEmitResult = {
    proposals: [],
    fromRegime: null,
    toRegime: null,
    confirmedAtBar: null,
    enterAllowed: false,
    enterSuppressedReason: "no_preferred_side",
  };
  if (!flip.flipped) return empty;

  const preferred = regimePreferredSide(flip.toRegime);
  if (preferred == null) return empty;

  const proposals: SarOrderProposal[] = [];
  const oldSide: PositionSide = preferred === "long" ? "short" : "long";
  const oldPos = openPositions.find((p) => p.side === oldSide && p.quantity > 0) ?? null;
  if (oldPos) {
    proposals.push({
      side: oldPos.side === "long" ? "sell" : "buy",
      positionSide: oldPos.side,
      intent: "EXIT",
      quantity: oldPos.quantity,
      reason: "sar_exit_old_side",
    });
  }

  const oppositeAlreadyOpen = openPositions.some((p) => p.side === preferred && p.quantity > 0);
  let enterAllowed = false;
  let enterSuppressedReason: SarEmitResult["enterSuppressedReason"] = null;
  if (!allowedSides.includes(preferred)) {
    enterSuppressedReason = "side_not_allowed";
  } else if (oppositeAlreadyOpen) {
    enterSuppressedReason = "opposite_already_open";
  } else {
    enterAllowed = true;
    proposals.push({
      side: preferred === "long" ? "buy" : "sell",
      positionSide: preferred,
      intent: "ENTER",
      reason: "sar_enter_new_side",
      ...(typeof notionalQuoteForEnter === "number" && Number.isFinite(notionalQuoteForEnter) && notionalQuoteForEnter > 0
        ? { notionalQuote: notionalQuoteForEnter }
        : {}),
    });
  }

  return {
    proposals,
    fromRegime: flip.fromRegime,
    toRegime: flip.toRegime,
    confirmedAtBar: flip.confirmedAtBar,
    enterAllowed,
    enterSuppressedReason,
  };
}
