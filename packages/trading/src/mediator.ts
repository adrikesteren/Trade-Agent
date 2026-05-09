import {
  evaluateNewEntry,
  type ProposedOrder,
  type RiskRailsConfig,
  type RiskStateSnapshot,
} from "@repo/risk";

/** Matches `trading.signal_intent` enum. */
export type SignalIntent = "ENTER" | "ADD" | "REDUCE" | "EXIT" | "HOLD";

export type MediatorRailsConfig = RiskRailsConfig & {
  /** When true, ADD with an open position runs the entry risk gate. Default false (v1). */
  allowAdd?: boolean;
};

export type TradeDecisionInput = {
  rails: MediatorRailsConfig;
  risk: RiskStateSnapshot;
  marketSymbol: string;
  /** Intents from all agents for this bar (same user, market, timeframe, close). */
  signalIntents: SignalIntent[];
  inPosition: boolean;
  /** Suggested EUR size before risk clamp (worker/env). */
  notionalEurSuggested?: number;
};

export type TradeDecisionOutput = {
  approved: boolean;
  reasonCodes: string[];
  riskSnapshot: RiskStateSnapshot;
  resolvedIntent: SignalIntent;
  proposedOrder?: ProposedOrder;
};

const DEFAULT_NOTIONAL_EUR = 100;

const INTENT_PRIORITY: Record<SignalIntent, number> = {
  EXIT: 50,
  REDUCE: 40,
  ADD: 30,
  ENTER: 20,
  HOLD: 10,
};

/**
 * Strongest intent across agents for one bar (EXIT first, then REDUCE, ADD, ENTER, HOLD).
 */
export function aggregateSignalIntents(intents: SignalIntent[]): SignalIntent {
  if (intents.length === 0) return "HOLD";
  let best: SignalIntent = "HOLD";
  let bestP = INTENT_PRIORITY[best];
  for (const cur of intents) {
    const p = INTENT_PRIORITY[cur] ?? 0;
    if (p > bestP) {
      best = cur;
      bestP = p;
    }
  }
  return best;
}

/**
 * Single authority: aggregate signals + position + risk → approve/deny (no orders).
 */
export function evaluateTradeDecision(input: TradeDecisionInput): TradeDecisionOutput {
  const { rails, risk, marketSymbol, signalIntents, inPosition } = input;
  const riskSnapshot = { ...risk };

  if (signalIntents.length === 0) {
    return {
      approved: false,
      reasonCodes: ["no_signals"],
      riskSnapshot,
      resolvedIntent: "HOLD",
    };
  }

  const resolvedIntent = aggregateSignalIntents(signalIntents);

  if (resolvedIntent === "HOLD") {
    return {
      approved: false,
      reasonCodes: ["hold_intent"],
      riskSnapshot,
      resolvedIntent,
    };
  }

  if (resolvedIntent === "EXIT") {
    if (!inPosition) {
      return { approved: false, reasonCodes: ["no_position"], riskSnapshot, resolvedIntent };
    }
    return {
      approved: false,
      reasonCodes: ["exit_not_implemented"],
      riskSnapshot,
      resolvedIntent,
    };
  }

  if (resolvedIntent === "REDUCE") {
    if (!inPosition) {
      return { approved: false, reasonCodes: ["no_position"], riskSnapshot, resolvedIntent };
    }
    return {
      approved: false,
      reasonCodes: ["reduce_not_implemented"],
      riskSnapshot,
      resolvedIntent,
    };
  }

  if (resolvedIntent === "ADD") {
    if (!inPosition) {
      return { approved: false, reasonCodes: ["no_position"], riskSnapshot, resolvedIntent };
    }
    if (!rails.allowAdd) {
      return { approved: false, reasonCodes: ["add_not_enabled"], riskSnapshot, resolvedIntent };
    }
    return approveBuyAfterRisk(input, resolvedIntent, riskSnapshot);
  }

  if (resolvedIntent === "ENTER") {
    if (inPosition) {
      return {
        approved: false,
        reasonCodes: ["already_in_position"],
        riskSnapshot,
        resolvedIntent,
      };
    }
    return approveBuyAfterRisk(input, resolvedIntent, riskSnapshot);
  }

  return {
    approved: false,
    reasonCodes: ["unhandled_intent"],
    riskSnapshot,
    resolvedIntent: "HOLD",
  };
}

function approveBuyAfterRisk(
  input: TradeDecisionInput,
  resolvedIntent: SignalIntent,
  riskSnapshot: RiskStateSnapshot,
): TradeDecisionOutput {
  const { rails, risk, marketSymbol } = input;
  const notionalEur = Math.min(
    input.notionalEurSuggested ?? DEFAULT_NOTIONAL_EUR,
    risk.equityEur * rails.maxRiskPerTrade,
  );

  if (notionalEur <= 0 || !Number.isFinite(notionalEur)) {
    return {
      approved: false,
      reasonCodes: ["invalid_notional"],
      riskSnapshot,
      resolvedIntent,
    };
  }

  const proposed: ProposedOrder = {
    symbol: marketSymbol,
    side: "buy",
    notionalEur,
  };

  const ev = evaluateNewEntry(rails, risk, proposed);
  if (!ev.allowed) {
    return {
      approved: false,
      reasonCodes: ev.reasonCodes,
      riskSnapshot,
      resolvedIntent,
      proposedOrder: proposed,
    };
  }

  return {
    approved: true,
    reasonCodes: [],
    riskSnapshot,
    resolvedIntent,
    proposedOrder: proposed,
  };
}
