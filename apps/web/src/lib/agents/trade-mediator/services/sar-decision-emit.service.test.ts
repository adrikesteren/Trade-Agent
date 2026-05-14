import { describe, expect, it } from "vitest";

import { emitSarDecisions } from "./sar-decision-emit.service";
import type { RegimeFlipResult } from "./regime-flip-detect.service";

const NO_FLIP: RegimeFlipResult = { flipped: false, fromRegime: null, toRegime: null, confirmedAtBar: null };
const BULL_TO_BEAR: RegimeFlipResult = {
  flipped: true,
  fromRegime: "bull",
  toRegime: "bear",
  confirmedAtBar: "2026-01-03T00:00:00.000Z",
};
const BEAR_TO_BULL: RegimeFlipResult = {
  flipped: true,
  fromRegime: "bear",
  toRegime: "bull",
  confirmedAtBar: "2026-01-03T00:00:00.000Z",
};

describe("emitSarDecisions", () => {
  it("returns empty result when there is no flip", () => {
    const r = emitSarDecisions({ flip: NO_FLIP, allowedSides: ["long", "short"], openPositions: [] });
    expect(r.proposals).toEqual([]);
  });

  it("on bull→bear with long-only executor and no open position: nothing to do", () => {
    const r = emitSarDecisions({
      flip: BULL_TO_BEAR,
      allowedSides: ["long"],
      openPositions: [],
    });
    expect(r.proposals).toEqual([]);
    expect(r.enterAllowed).toBe(false);
    expect(r.enterSuppressedReason).toBe("side_not_allowed");
  });

  it("on bull→bear with long-only executor holding LONG: only EXIT long, no opposite ENTER (Bitvavo case)", () => {
    const r = emitSarDecisions({
      flip: BULL_TO_BEAR,
      allowedSides: ["long"],
      openPositions: [{ side: "long", quantity: 5 }],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      side: "sell",
      positionSide: "long",
      intent: "EXIT",
      quantity: 5,
      reason: "sar_exit_old_side",
    });
    expect(r.enterAllowed).toBe(false);
    expect(r.enterSuppressedReason).toBe("side_not_allowed");
  });

  it("on bull→bear with long+short executor holding LONG: EXIT long + ENTER short (paired)", () => {
    const r = emitSarDecisions({
      flip: BULL_TO_BEAR,
      allowedSides: ["long", "short"],
      openPositions: [{ side: "long", quantity: 5 }],
      notionalQuoteForEnter: 250,
    });
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0]).toMatchObject({ intent: "EXIT", positionSide: "long", quantity: 5 });
    expect(r.proposals[1]).toMatchObject({
      intent: "ENTER",
      positionSide: "short",
      side: "sell",
      notionalQuote: 250,
      reason: "sar_enter_new_side",
    });
    expect(r.enterAllowed).toBe(true);
  });

  it("on bear→bull with long+short executor holding SHORT: EXIT short + ENTER long", () => {
    const r = emitSarDecisions({
      flip: BEAR_TO_BULL,
      allowedSides: ["long", "short"],
      openPositions: [{ side: "short", quantity: 7 }],
      notionalQuoteForEnter: 100,
    });
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0]).toMatchObject({ intent: "EXIT", positionSide: "short", side: "buy", quantity: 7 });
    expect(r.proposals[1]).toMatchObject({ intent: "ENTER", positionSide: "long", side: "buy", notionalQuote: 100 });
  });

  it("on confirmed flip with no open position: only ENTER opposite if allowed", () => {
    const r = emitSarDecisions({
      flip: BULL_TO_BEAR,
      allowedSides: ["long", "short"],
      openPositions: [],
      notionalQuoteForEnter: 50,
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ intent: "ENTER", positionSide: "short" });
  });

  it("does not emit ENTER when the opposite side is already open", () => {
    const r = emitSarDecisions({
      flip: BULL_TO_BEAR,
      allowedSides: ["long", "short"],
      openPositions: [
        { side: "long", quantity: 5 },
        { side: "short", quantity: 1 },
      ],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].intent).toBe("EXIT");
    expect(r.enterAllowed).toBe(false);
    expect(r.enterSuppressedReason).toBe("opposite_already_open");
  });
});
