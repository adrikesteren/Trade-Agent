import { describe, expect, it } from "vitest";

import { applyRegimeGating, type MediatorMatchedSignal } from "./regime-gating.service";

function sig(agent_slug: string, intent: string, regime?: "bull" | "bear" | "sideways"): MediatorMatchedSignal {
  return {
    id: `${agent_slug}-${intent}`,
    agent_slug,
    intent,
    metadata: regime ? { regime } : null,
  };
}

describe("applyRegimeGating", () => {
  it("passes through when gating is disabled", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bear")],
      regimeGatingEnabled: false,
    });
    expect(r.effectiveIntents).toEqual(["ENTER", "HOLD"]);
    expect(r.demotionReason).toBeNull();
    expect(r.regime).toBeNull();
    expect(r.regimeSignalSide).toBeNull();
  });

  it("passes through when no regime signal is present", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("rsi-reversion-15m-v1", "ENTER")],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["ENTER", "ENTER"]);
    expect(r.demotionReason).toBeNull();
    expect(r.regime).toBeNull();
  });

  it("allows ENTER under bull regime", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bull")],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["ENTER", "HOLD"]);
    expect(r.demotionReason).toBeNull();
    expect(r.regime).toBe("bull");
    expect(r.regimeSignalSide).toBe("long");
  });

  it("strips ENTER under bear regime and adds regime_bear_skip reason", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "bear")],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["HOLD"]);
    expect(r.demotionReason).toBe("regime_bear_skip");
    expect(r.regime).toBe("bear");
    expect(r.regimeSignalSide).toBe("short");
  });

  it("preserves EXIT intents under bear regime (only ENTER/ADD are stripped)", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "EXIT"), sig("regime-classifier-15m-v1", "HOLD", "bear")],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["EXIT", "HOLD"]);
    expect(r.demotionReason).toBe("regime_bear_skip");
  });

  it("strips ENTER under sideways regime when no multi-TF confluence is present", () => {
    const r = applyRegimeGating({
      matched: [sig("ma-cross-15m-v1", "ENTER"), sig("regime-classifier-15m-v1", "HOLD", "sideways")],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["HOLD"]);
    expect(r.demotionReason).toBe("regime_sideways_skip");
    expect(r.regime).toBe("sideways");
    expect(r.regimeSignalSide).toBeNull();
  });

  it("allows ENTER under sideways regime when multi-TF confluence also enters", () => {
    const r = applyRegimeGating({
      matched: [
        sig("ma-cross-15m-v1", "ENTER"),
        sig("multi-tf-confluence-15m-v1", "ENTER"),
        sig("regime-classifier-15m-v1", "HOLD", "sideways"),
      ],
      regimeGatingEnabled: true,
    });
    expect(r.effectiveIntents).toEqual(["ENTER", "ENTER", "HOLD"]);
    expect(r.demotionReason).toBeNull();
    expect(r.regime).toBe("sideways");
  });
});
