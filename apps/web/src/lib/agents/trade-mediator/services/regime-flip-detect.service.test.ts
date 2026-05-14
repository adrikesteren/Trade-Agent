import { describe, expect, it } from "vitest";

import { detectRegimeFlip, type RegimePoint } from "./regime-flip-detect.service";

function p(regime: "bull" | "bear" | "sideways", day: number): RegimePoint {
  return { regime, closeTimeIso: new Date(Date.UTC(2026, 0, 1 + day)).toISOString() };
}

describe("detectRegimeFlip", () => {
  it("returns no-flip when fewer than 3 points are supplied", () => {
    expect(detectRegimeFlip([p("bull", 0), p("bear", 1)]).flipped).toBe(false);
  });

  it("returns no-flip on a steady bull regime", () => {
    expect(detectRegimeFlip([p("bull", 0), p("bull", 1), p("bull", 2)]).flipped).toBe(false);
  });

  it("returns no-flip when t flips back (unconfirmed flip)", () => {
    // bull, bear, bull: flip at t-1 was not confirmed at t.
    expect(detectRegimeFlip([p("bull", 0), p("bear", 1), p("bull", 2)]).flipped).toBe(false);
  });

  it("detects bull→bear confirmed flip", () => {
    const r = detectRegimeFlip([p("bull", 0), p("bear", 1), p("bear", 2)]);
    expect(r.flipped).toBe(true);
    expect(r.fromRegime).toBe("bull");
    expect(r.toRegime).toBe("bear");
    expect(r.confirmedAtBar).toBe(p("bear", 2).closeTimeIso);
  });

  it("detects bear→bull confirmed flip", () => {
    const r = detectRegimeFlip([p("bear", 0), p("bull", 1), p("bull", 2)]);
    expect(r.flipped).toBe(true);
    expect(r.fromRegime).toBe("bear");
    expect(r.toRegime).toBe("bull");
  });

  it("does NOT trigger SAR when the confirmed new regime is sideways (deliberate no-op)", () => {
    const r = detectRegimeFlip([p("bull", 0), p("sideways", 1), p("sideways", 2)]);
    expect(r.flipped).toBe(false);
  });

  it("uses only the latest 3 points (longer history is allowed)", () => {
    const r = detectRegimeFlip([
      p("bear", 0),
      p("bear", 1),
      p("bear", 2),
      p("bull", 3),
      p("bull", 4),
    ]);
    expect(r.flipped).toBe(true);
    expect(r.fromRegime).toBe("bear");
    expect(r.toRegime).toBe("bull");
    expect(r.confirmedAtBar).toBe(p("bull", 4).closeTimeIso);
  });
});
