import { describe, expect, it } from "vitest";

import { applyRegimeGating, type MediatorMatchedSignal } from "./regime-gating.service";
import { detectRegimeFlip, type RegimePoint } from "./regime-flip-detect.service";
import { emitSarDecisions, type PositionSide, type SarOpenPosition } from "./sar-decision-emit.service";

/**
 * P3 ensemble test — verifies the contract between the three pure helpers that
 * compose the regime-aware mediator + SAR pipeline:
 *
 *   1. applyRegimeGating         — demotes ENTERs when regime is unfavourable
 *   2. detectRegimeFlip          — detects 3-bar confirmed bull↔bear flip
 *   3. emitSarDecisions          — paired EXIT(old side) + ENTER(opposite)
 *
 * The matrix below covers the practical scenarios we care about for paper
 * validation (Bitvavo long-only, dual-side exchange, no flip, sideways drift).
 */

function sig(agent_slug: string, intent: "ENTER" | "EXIT" | "HOLD", regime?: "bull" | "bear" | "sideways"): MediatorMatchedSignal {
  return {
    id: `sig-${agent_slug}-${intent}-${regime ?? ""}`,
    agent_slug,
    intent,
    metadata: regime ? { regime } : null,
  };
}

function regimePoint(closeTimeIso: string, regime: "bull" | "bear" | "sideways"): RegimePoint {
  return { closeTimeIso, regime };
}

describe("P3 ensemble: regime gating + SAR", () => {
  it("scenario A — bull regime, no flip: ENTER passes, no SAR fires", () => {
    const matched = [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bull")];
    const gate = applyRegimeGating({ matched, regimeGatingEnabled: true });
    expect(gate.effectiveIntents).toContain("ENTER");
    expect(gate.demotionReason).toBeNull();

    const flip = detectRegimeFlip([
      regimePoint("2026-01-01T10:00:00Z", "bull"),
      regimePoint("2026-01-01T10:15:00Z", "bull"),
      regimePoint("2026-01-01T10:30:00Z", "bull"),
    ]);
    expect(flip.flipped).toBe(false);

    const sar = emitSarDecisions({ flip, allowedSides: ["long"], openPositions: [], notionalQuoteForEnter: 100 });
    expect(sar.proposals).toEqual([]);
  });

  it("scenario B — bear regime, no flip: ENTER demoted, no SAR fires", () => {
    const matched = [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bear")];
    const gate = applyRegimeGating({ matched, regimeGatingEnabled: true });
    expect(gate.effectiveIntents).not.toContain("ENTER");
    expect(gate.demotionReason).not.toBeNull();

    const flip = detectRegimeFlip([
      regimePoint("2026-01-02T10:00:00Z", "bear"),
      regimePoint("2026-01-02T10:15:00Z", "bear"),
      regimePoint("2026-01-02T10:30:00Z", "bear"),
    ]);
    expect(flip.flipped).toBe(false);

    const sar = emitSarDecisions({ flip, allowedSides: ["long", "short"], openPositions: [], notionalQuoteForEnter: 100 });
    expect(sar.proposals).toEqual([]);
  });

  it("scenario C — confirmed bull→bear flip on Bitvavo (long-only): EXIT-long fires, no ENTER-short", () => {
    const flip = detectRegimeFlip([
      regimePoint("2026-01-03T10:00:00Z", "bull"),
      regimePoint("2026-01-03T10:15:00Z", "bear"),
      regimePoint("2026-01-03T10:30:00Z", "bear"),
    ]);
    expect(flip.flipped).toBe(true);
    expect(flip.toRegime).toBe("bear");

    const positions: SarOpenPosition[] = [{ side: "long", quantity: 0.5 }];
    const sar = emitSarDecisions({
      flip,
      allowedSides: ["long"] as PositionSide[],
      openPositions: positions,
      notionalQuoteForEnter: 100,
    });
    const intents = sar.proposals.map((p) => `${p.intent}-${p.positionSide}`);
    expect(intents).toContain("EXIT-long");
    expect(intents).not.toContain("ENTER-short");
  });

  it("scenario D — confirmed bear→bull flip on dual-side exchange: EXIT-short + ENTER-long", () => {
    const flip = detectRegimeFlip([
      regimePoint("2026-01-04T10:00:00Z", "bear"),
      regimePoint("2026-01-04T10:15:00Z", "bull"),
      regimePoint("2026-01-04T10:30:00Z", "bull"),
    ]);
    expect(flip.flipped).toBe(true);
    expect(flip.toRegime).toBe("bull");

    const positions: SarOpenPosition[] = [{ side: "short", quantity: 1.5 }];
    const sar = emitSarDecisions({
      flip,
      allowedSides: ["long", "short"] as PositionSide[],
      openPositions: positions,
      notionalQuoteForEnter: 200,
    });
    const intents = sar.proposals.map((p) => `${p.intent}-${p.positionSide}`);
    expect(intents).toContain("EXIT-short");
    expect(intents).toContain("ENTER-long");
  });

  it("scenario E — sideways regime drops ENTER unless multi-TF confluence is present", () => {
    const withoutMtf = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "sideways")],
      regimeGatingEnabled: true,
    });
    expect(withoutMtf.effectiveIntents).not.toContain("ENTER");

    const withMtf = applyRegimeGating({
      matched: [
        sig("ma-cross-15m-v1", "ENTER"),
        sig("multi-tf-confluence-15m-v1", "ENTER"),
        sig("regime-classifier-15m-v1", "HOLD", "sideways"),
      ],
      regimeGatingEnabled: true,
    });
    expect(withMtf.effectiveIntents).toContain("ENTER");
  });

  it("scenario F — gating disabled is the legacy path (regime is informational only)", () => {
    const gate = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bear")],
      regimeGatingEnabled: false,
    });
    expect(gate.effectiveIntents).toContain("ENTER");
    expect(gate.demotionReason).toBeNull();
  });
});
