import {
  evaluateNewEntry,
  type ProposedOrder,
  type RiskRailsConfig,
  type RiskStateSnapshot,
} from "@repo/risk";

export type SignalAction = "buy" | "sell" | "hold";

export type AgentSignal = {
  agentId: string;
  symbol: string;
  action: SignalAction;
  confidence: number;
  /** Suggested notional in EUR for paper sizing; mediator may clamp. */
  notionalEur?: number;
};

export type MediatorInput = {
  rails: RiskRailsConfig;
  risk: RiskStateSnapshot;
  signal: AgentSignal;
};

export type MediatorDecision = {
  approved: boolean;
  reasonCodes: string[];
  riskSnapshot: RiskStateSnapshot;
  proposed?: ProposedOrder;
};

const DEFAULT_NOTIONAL_EUR = 100;

/**
 * Single authority: translate agent signal + risk into approve/deny.
 * Does not place orders — executor handles persistence.
 */
export function runMediator(input: MediatorInput): MediatorDecision {
  const { rails, risk, signal } = input;
  const riskSnapshot = { ...risk };

  if (signal.action === "hold") {
    return {
      approved: false,
      reasonCodes: ["hold_signal"],
      riskSnapshot,
    };
  }

  const notionalEur = Math.min(
    signal.notionalEur ?? DEFAULT_NOTIONAL_EUR,
    risk.equityEur * rails.maxRiskPerTrade,
  );

  if (notionalEur <= 0 || !Number.isFinite(notionalEur)) {
    return {
      approved: false,
      reasonCodes: ["invalid_notional"],
      riskSnapshot,
    };
  }

  const proposed: ProposedOrder = {
    symbol: signal.symbol,
    side: signal.action,
    notionalEur,
  };

  const ev = evaluateNewEntry(rails, risk, proposed);
  if (!ev.allowed) {
    return {
      approved: false,
      reasonCodes: ev.reasonCodes,
      riskSnapshot,
      proposed,
    };
  }

  return {
    approved: true,
    reasonCodes: [],
    riskSnapshot,
    proposed,
  };
}
