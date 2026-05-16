import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as AssetsSelector from "@/lib/selectors/assets-selector";

export type TradeFillSlackSource = "executor-catalog-close" | "bitvavo-reconcile";

export type TradeFillSlackPayload = {
  /** Logged on HTTP errors only. */
  source: TradeFillSlackSource;
  side: "buy" | "sell";
  /** `catalog.assets` display (name, else code). */
  assetName: string;
  /** `trading.executors.name`. */
  executorName: string;
  /** `catalog.exchanges.name` (else code). */
  exchangeName: string;
};

/** First `signalsIn[].agent_id` from mediator payload (sorted signals). */
export function primaryAgentSlugFromDecisionPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const si = payload?.signalsIn;
  if (!Array.isArray(si) || si.length === 0) return null;
  const first = si[0] as Record<string, unknown>;
  const slug = typeof first.agent_id === "string" ? first.agent_id.trim() : "";
  return slug || null;
}

/** All agents (small table): slug → display label. */
export async function fetchTradeFillSignalAgentLabels(admin: SupabaseClient): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const { data, error } = await admin.schema("trading").from("signal_agents").select("agent_id, description");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const slug = String((row as { agent_id?: string }).agent_id ?? "").trim();
    if (!slug) continue;
    const desc = String((row as { description?: string | null }).description ?? "").trim();
    m.set(slug, desc || slug);
  }
  return m;
}

export function labelFromSignalAgentMap(map: Map<string, string>, slug: string | null): string {
  if (!slug) return "—";
  return map.get(slug) ?? slug;
}

/** Per market id: asset `name` or `code`, else `—` if no asset link. */
export async function fetchAssetDisplayNameByMarketId(
  admin: SupabaseClient,
  assetIdByMarket: Map<string, string | null>,
): Promise<Map<string, string>> {
  const byMarket = new Map<string, string>();
  const ids = [...new Set([...assetIdByMarket.values()].filter((x): x is string => Boolean(x)))];
  const byAssetId = new Map<string, string>();
  if (ids.length) {
    const chunk = 200;
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      const data = await AssetsSelector.selectIdCodeNameByIds(admin, part);
      for (const r of data) {
        const nm = String(r.name ?? "").trim();
        const code = String(r.code ?? "").trim();
        byAssetId.set(r.id, nm || code || "—");
      }
    }
  }
  for (const [mid, aid] of assetIdByMarket) {
    byMarket.set(mid, aid ? (byAssetId.get(aid) ?? "—") : "—");
  }
  return byMarket;
}

function slackMrkdwnEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function assetNameFallbackFromMarketSymbol(marketSymbol: string): string {
  const t = marketSymbol.trim();
  if (!t) return "—";
  const i = t.indexOf("-");
  return i > 0 ? t.slice(0, i) : t;
}

/** When DB asset label is missing, derive a short base symbol from the market pair. */
export function resolveTradeFillAssetDisplayName(
  assetNameFromDb: string | undefined,
  marketSymbol: string,
): string {
  const db = assetNameFromDb?.trim();
  if (db && db !== "—") return db;
  return assetNameFallbackFromMarketSymbol(marketSymbol);
}

const SLACK_BUY_COLOR = "#2eb67d";
const SLACK_SELL_COLOR = "#e01e5a";

function buildSlackBody(p: TradeFillSlackPayload): Record<string, unknown> {
  const sideUpper = p.side === "buy" ? "BUY" : "SELL";
  const color = p.side === "buy" ? SLACK_BUY_COLOR : SLACK_SELL_COLOR;
  const executorBracket = slackMrkdwnEscape(p.executorName.trim() || "—");
  const asset = slackMrkdwnEscape(p.assetName.trim() || "—");
  const exchange = slackMrkdwnEscape(p.exchangeName.trim() || "—");
  const mrkdwn = `[${executorBracket}]: *${sideUpper}* - ${asset} - ${exchange}`;
  const plain = `[${p.executorName.trim() || "—"}]: ${sideUpper} - ${p.assetName.trim() || "—"} - ${p.exchangeName.trim() || "—"}`;
  return {
    text: plain,
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: mrkdwn },
          },
        ],
      },
    ],
  };
}

/**
 * Optional Slack Incoming Webhook (#trade-fills). Never throws; logs on failure.
 * Message: `[Executor]: BUY/SELL - Asset - Exchange`; buy = green / sell = red attachment bar.
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
      body: JSON.stringify(buildSlackBody(payload)),
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
