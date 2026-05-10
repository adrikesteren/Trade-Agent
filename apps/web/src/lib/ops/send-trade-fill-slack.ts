import "server-only";

import type { ExecutionMode } from "@/lib/trading/executors";

export type TradeFillSlackSource = "executor-catalog-close" | "bitvavo-reconcile";

export type TradeFillSlackPayload = {
  source: TradeFillSlackSource;
  side: "buy" | "sell";
  executorName: string;
  executorId: string;
  marketSymbol: string;
  quantity: number;
  price: number;
  fee: number;
  executionMode: ExecutionMode;
  paper: boolean;
  orderId: string;
  /** When live fill succeeded but applyExecutorTradeBuyDebit failed (logged separately). */
  ledgerDebitFailed?: boolean;
};

function shortId(id: string): string {
  const t = id.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 8)}…`;
}

function fmtNum(n: number, maxFrac: number): string {
  if (!Number.isFinite(n)) return "?";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0,
  });
}

function buildText(p: TradeFillSlackPayload): string {
  const mode = p.paper ? "paper" : "live";
  const exec = `${p.executorName.trim() || "Executor"} (${shortId(p.executorId)})`;
  const side = p.side.toUpperCase();
  const ledgerNote = p.ledgerDebitFailed ? " · ledger debit failed (see logs)" : "";
  return (
    `*${side}* ${p.marketSymbol} · ${exec}\n` +
    `qty ${fmtNum(p.quantity, 8)} @ ${fmtNum(p.price, 6)} EUR · fee ${fmtNum(p.fee, 4)} EUR · ${mode} (${p.executionMode})` +
    ` · order \`${shortId(p.orderId)}\`${ledgerNote}\n` +
    `_source: ${p.source}_`
  );
}

/**
 * Optional Slack Incoming Webhook (#trade-fills). Never throws; logs on failure.
 */
export async function sendTradeFillSlack(payload: TradeFillSlackPayload): Promise<void> {
  const url = process.env.SLACK_TRADE_FILLS_WEBHOOK_URL?.trim();
  if (!url) return;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: buildText(payload) }),
      signal: ac.signal,
    });
    if (!res.ok) {
      console.error(`sendTradeFillSlack: webhook HTTP ${res.status} (${payload.source})`);
    }
  } catch (e) {
    console.error("sendTradeFillSlack: webhook failed:", e instanceof Error ? e.message : e);
  } finally {
    clearTimeout(timer);
  }
}
