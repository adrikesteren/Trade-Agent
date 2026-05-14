/**
 * P3 — pure regime-gating helper for the catalog-close mediator.
 *
 * Given the set of matched signals for a (market, bar), this helper:
 * 1. Finds the regime classifier's signal (by agent slug `regime-classifier-15m-v1`).
 * 2. Reads `metadata.regime` (`bull` / `bear` / `sideways`).
 * 3. Decides whether ENTER intents survive or get demoted to HOLD with a
 *    `regime_*_skip` reason code.
 *
 * Config-driven via `mediator_rails_extra.regimeGating` (default: true).
 *
 * Pure (no Supabase access) so it is easy to unit-test.
 */

export type RegimeLabel = "bull" | "bear" | "sideways";

export type MediatorMatchedSignal = {
  id: string;
  intent: string;
  agent_slug: string;
  metadata?: Record<string, unknown> | null;
};

export type RegimeGatingDecision = {
  /** Final intent the mediator should act on (filtered by regime). */
  effectiveIntents: string[];
  /** When non-null, the regime forced a demotion; mediator should add this to reason_codes. */
  demotionReason: string | null;
  /** The regime label observed for this bar (or null when no regime signal exists). */
  regime: RegimeLabel | null;
  /** Detected as side hint when the regime classifier emitted a directional signal_side. */
  regimeSignalSide: "long" | "short" | null;
};

const REGIME_AGENT_SLUG = "regime-classifier-15m-v1";
const MTF_AGENT_SLUG = "multi-tf-confluence-15m-v1";

function readRegime(metadata: Record<string, unknown> | null | undefined): RegimeLabel | null {
  if (!metadata || typeof metadata !== "object") return null;
  const r = (metadata as Record<string, unknown>).regime;
  if (r === "bull" || r === "bear" || r === "sideways") return r;
  return null;
}

/**
 * Apply regime gating to a list of matched signals for one (market, bar).
 * The caller is responsible for ALSO stamping `decision.position_side` from
 * `regimeSignalSide` when present (the gating helper itself doesn't mutate).
 *
 * Behavior:
 * - `regimeGatingEnabled=false` ⇢ pass-through (`effectiveIntents = intents`).
 * - No regime signal in `matched` ⇢ pass-through.
 * - `regime='bear'` ⇢ ENTER intents are stripped, replaced by HOLD with
 *   reason `regime_bear_skip`.
 * - `regime='sideways'` ⇢ ENTER intents are stripped UNLESS the multi-TF
 *   confluence agent also emitted a non-HOLD signal in the same bar; if so,
 *   ENTER survives (interpreted as "regime is dull but confluence is strong
 *   enough to still take the entry").
 * - `regime='bull'` ⇢ pass-through; ENTER allowed.
 */
export function applyRegimeGating(args: {
  matched: MediatorMatchedSignal[];
  regimeGatingEnabled: boolean;
}): RegimeGatingDecision {
  const { matched, regimeGatingEnabled } = args;
  const intents = matched.map((m) => m.intent);

  if (!regimeGatingEnabled) {
    return { effectiveIntents: intents, demotionReason: null, regime: null, regimeSignalSide: null };
  }

  const regimeSignal = matched.find((m) => m.agent_slug === REGIME_AGENT_SLUG);
  if (!regimeSignal) {
    return { effectiveIntents: intents, demotionReason: null, regime: null, regimeSignalSide: null };
  }
  const regime = readRegime(regimeSignal.metadata);
  if (!regime) {
    return { effectiveIntents: intents, demotionReason: null, regime: null, regimeSignalSide: null };
  }

  const regimeSignalSide: "long" | "short" | null =
    regime === "bear" ? "short" : regime === "bull" ? "long" : null;

  if (regime === "bull") {
    return { effectiveIntents: intents, demotionReason: null, regime, regimeSignalSide };
  }

  if (regime === "bear") {
    // ENTER intents stripped; the mediator should propose HOLD or honor an EXIT.
    const survivingIntents = intents.filter((i) => i !== "ENTER" && i !== "ADD");
    return {
      effectiveIntents: survivingIntents.length ? survivingIntents : ["HOLD"],
      demotionReason: "regime_bear_skip",
      regime,
      regimeSignalSide,
    };
  }

  // sideways
  const hasMtfConfluence = matched.some(
    (m) => m.agent_slug === MTF_AGENT_SLUG && (m.intent === "ENTER" || m.intent === "ADD"),
  );
  if (hasMtfConfluence) {
    return { effectiveIntents: intents, demotionReason: null, regime, regimeSignalSide };
  }
  const survivingIntents = intents.filter((i) => i !== "ENTER" && i !== "ADD");
  return {
    effectiveIntents: survivingIntents.length ? survivingIntents : ["HOLD"],
    demotionReason: "regime_sideways_skip",
    regime,
    regimeSignalSide,
  };
}
