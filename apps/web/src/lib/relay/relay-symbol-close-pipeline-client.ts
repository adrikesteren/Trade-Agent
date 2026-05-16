import "server-only";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { resolveWorkerCronSecret } from "@/lib/workers/resolve-worker-cron-secret";

export const RELAY_POLL_MS = 1000;
/** Max wait when chaining message-groups (exchange-close). */
export const RELAY_CHUNK_WAIT_MAX_MS = 3_600_000;

/** Per-message `timeout` (seconds) for Relay `historical-executor-replay` jobs — 30 minutes. */
export const RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S = 30 * 60;

/** Per-message `timeout` (seconds) for Relay `market-backfill-candles` jobs — 30 minutes. */
export const RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S = 30 * 60;

/** Per-message `timeout` (seconds) for Relay `market-evaluate-all-signals` jobs — 10 minutes. */
export const RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S = 10 * 60;

export function normalizeRelayBaseUrl(): string {
  loadMonorepoDotenvOnce();
  const raw = process.env.RELAY_APP_URL?.trim();
  if (!raw) {
    throw new Error("RELAY_APP_URL is not set (required for Relay enqueue)");
  }
  return raw.replace(/\/$/, "");
}

export function relayIngressAuthHeaders(): Headers {
  loadMonorepoDotenvOnce();
  const secret = process.env.RELAY_APP_SECRET?.trim();
  if (!secret) {
    throw new Error("RELAY_APP_SECRET is not set (Relay ingress Bearer)");
  }
  const h = new Headers();
  h.set("Authorization", `Bearer ${secret}`);
  return h;
}

export function relayIngressPostHeaders(): Headers {
  const h = relayIngressAuthHeaders();
  h.set("Content-Type", "application/json");
  return h;
}

export async function downstreamWorkerHeaders(): Promise<Record<string, string>> {
  loadMonorepoDotenvOnce();
  const cron = (await resolveWorkerCronSecret())?.trim();
  if (!cron) {
    throw new Error(
      "Worker cron secret missing: add public.system_settings row key cron_secret (JSON string or {secret}) or set CRON_SECRET.",
    );
  }
  return { Authorization: `Bearer ${cron}` };
}

export function relayMaxRetries(): number {
  loadMonorepoDotenvOnce();
  const raw = process.env.RELAY_EXCHANGE_CLOSE_MAX_RETRIES?.trim();
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

/** True when Relay ingress + `APP_URL` + worker cron secret (DB or env) are available. */
export async function isRelayWorkerEnqueueConfigured(): Promise<boolean> {
  loadMonorepoDotenvOnce();
  if (
    !process.env.RELAY_APP_URL?.trim() ||
    !process.env.RELAY_APP_SECRET?.trim() ||
    !process.env.APP_URL?.trim()
  ) {
    return false;
  }
  const cron = await resolveWorkerCronSecret();
  return Boolean(cron?.trim());
}

/** Worker URL for one catalog asset CoinGecko coin id discovery (`source` → `sync_runs.trigger_source` when used). */
export function buildFindCoingeckoIdWorkerUrl(appBase: string, assetCode: string, source: string): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/assets/find-coingecko-id`);
  u.searchParams.set("assetCode", assetCode.trim());
  if (source) u.searchParams.set("source", source);
  return u.toString();
}

/** Orchestrator: same worker route with `all=true` (Relay message-group or inline fallback). */
export function buildFindCoingeckoIdAllWorkerUrl(appBase: string, source: string): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/assets/find-coingecko-id`);
  u.searchParams.set("all", "true");
  if (source) u.searchParams.set("source", source);
  return u.toString();
}

/**
 * @deprecated Prefer {@link buildFindCoingeckoIdAllWorkerUrl} with explicit `source`.
 * Historical URL for overview / cron; defaults `source=manual`.
 */
export function buildCoingeckoCoinIdSyncWorkerUrl(appBase: string): string {
  return buildFindCoingeckoIdAllWorkerUrl(appBase, "manual");
}

/** Worker URL for one historical executor replay (`executorId` = `trading.executors.id`). */
export function buildHistoricalExecutorReplayWorkerUrl(appBase: string, executorId: string): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/historical-executor-replay`);
  u.searchParams.set("executorId", executorId.trim());
  return u.toString();
}

/**
 * Worker URL for one "Backfill candles" market run (Ingest Agent + Signal Agent over a UTC window).
 * `endDate` is optional — leave empty to backfill up to today.
 */
export function buildMarketBackfillCandlesWorkerUrl(
  appBase: string,
  args: { marketId: string; startDate: string; endDate?: string | null },
): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/market-backfill-candles`);
  u.searchParams.set("marketId", args.marketId.trim());
  u.searchParams.set("startDate", args.startDate.trim());
  const end = (args.endDate ?? "").trim();
  if (end) u.searchParams.set("endDate", end);
  return u.toString();
}

/**
 * Worker URL for "Evaluate signals" header action: re-runs Signal Agent over every stored
 * 15m candle for one market, **skipping** `(agent, candle)` tuples that already have signals
 * for the automation user.
 */
export function buildMarketEvaluateAllSignalsWorkerUrl(
  appBase: string,
  marketId: string,
  options?: {
    forceAgentSlugs?: readonly string[];
    /** Optional close-time slice (ISO 8601) — used by the chunked Relay publisher. */
    closeTimeGteIso?: string | null;
    /** Optional close-time slice (ISO 8601) — used by the chunked Relay publisher. */
    closeTimeLteIso?: string | null;
  },
): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/market-evaluate-all-signals`);
  u.searchParams.set("marketId", marketId.trim());
  const force = (options?.forceAgentSlugs ?? []).map((s) => s.trim()).filter(Boolean);
  if (force.length > 0) {
    u.searchParams.set("forceAgentSlugs", force.join(","));
  }
  const gte = (options?.closeTimeGteIso ?? "").trim();
  if (gte) u.searchParams.set("closeTimeGteIso", gte);
  const lte = (options?.closeTimeLteIso ?? "").trim();
  if (lte) u.searchParams.set("closeTimeLteIso", lte);
  return u.toString();
}

export function buildSymbolClosePipelineUrl(
  appBase: string,
  assetCode: string,
  exchangeCode: string,
  quote: string,
): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/symbol-close-pipeline`);
  u.searchParams.set("assetCode", assetCode);
  u.searchParams.set("exchangeCode", exchangeCode);
  if (quote !== "EUR") {
    u.searchParams.set("quote", quote);
  }
  return u.toString();
}

function toRelayOriginAndPath(targetUrl: string): { origin: string; path: string } {
  const u = new URL(targetUrl);
  const path = `${u.pathname}${u.search}`;
  return { origin: u.origin, path };
}

function toRelayOriginAndPaths(targetUrls: string[]): { origin: string; paths: string[] } {
  if (targetUrls.length === 0) {
    throw new Error("Relay message-group requires at least one target URL");
  }
  const first = toRelayOriginAndPath(targetUrls[0]!);
  const paths = [first.path];
  for (let i = 1; i < targetUrls.length; i += 1) {
    const part = toRelayOriginAndPath(targetUrls[i]!);
    if (part.origin !== first.origin) {
      throw new Error("Relay message-group requires all target URLs to share the same origin");
    }
    paths.push(part.path);
  }
  return { origin: first.origin, paths };
}

type RelayMessageRow = { id: string; status: string };

function isRelayMessageTerminal(status: string): boolean {
  return status === "delivered" || status === "dead";
}

export async function fetchRelayMessage(relayBase: string, messageId: string): Promise<RelayMessageRow | null> {
  const res = await fetch(`${relayBase}/api/v1/messages/${encodeURIComponent(messageId)}`, {
    method: "GET",
    headers: relayIngressAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Relay GET message failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as { message?: RelayMessageRow };
  return json.message ?? null;
}

export async function waitForRelayMessageTerminal(relayBase: string, messageId: string): Promise<RelayMessageRow> {
  const deadline = Date.now() + RELAY_CHUNK_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    const row = await fetchRelayMessage(relayBase, messageId);
    if (!row?.id) {
      throw new Error("Relay message response missing id");
    }
    if (isRelayMessageTerminal(row.status)) {
      return row;
    }
    await new Promise((r) => setTimeout(r, RELAY_POLL_MS));
  }
  throw new Error(
    `Timed out after ${RELAY_CHUNK_WAIT_MAX_MS}ms waiting for Relay message ${messageId} to finish (is Relay dispatch running?)`,
  );
}

export type PostRelaySingleMessageOptions = {
  /** Max time for the downstream HTTP request, in whole seconds. Sent to Relay as JSON key `timeout`. */
  timeoutSec?: number;
};

export async function postRelaySingleMessage(
  relayBase: string,
  url: string,
  headers: Record<string, string>,
  maxRetries: number,
  options?: PostRelaySingleMessageOptions,
): Promise<string> {
  const { origin, path } = toRelayOriginAndPath(url);
  const body: Record<string, unknown> = { origin, path, method: "POST", headers, maxRetries };
  const timeoutSec = options?.timeoutSec;
  if (timeoutSec != null) {
    const t = Math.floor(timeoutSec);
    if (Number.isFinite(t) && t > 0) {
      body.timeout = t;
    }
  }
  const res = await fetch(`${relayBase}/api/v1/messages`, {
    method: "POST",
    headers: relayIngressPostHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Relay POST /messages failed (${res.status}): ${text.slice(0, 800)}`);
  }
  const json = JSON.parse(text) as { message?: { id?: string } };
  const id = json.message?.id;
  if (!id) {
    throw new Error("Relay /messages response missing message.id");
  }
  return id;
}

export async function postRelayMessageGroup(
  relayBase: string,
  urls: string[],
  headers: Record<string, string>,
  maxRetries: number,
): Promise<{ groupId: string; messageIds: string[] }> {
  const { origin, paths } = toRelayOriginAndPaths(urls);
  const res = await fetch(`${relayBase}/api/v1/message-group`, {
    method: "POST",
    headers: relayIngressPostHeaders(),
    body: JSON.stringify({ origin, paths, method: "POST", headers, maxRetries }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Relay POST /message-group failed (${res.status}): ${text.slice(0, 800)}`);
  }
  const json = JSON.parse(text) as {
    message_group?: { id?: string };
    messages?: { id?: string }[];
  };
  const groupId = json.message_group?.id;
  const messageIds = (json.messages ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
  if (!groupId || messageIds.length !== paths.length) {
    throw new Error("Relay /message-group response missing message_group.id or message ids");
  }
  return { groupId, messageIds };
}
