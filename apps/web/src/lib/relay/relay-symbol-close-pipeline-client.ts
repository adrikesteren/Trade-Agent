import "server-only";

import { RelayClient } from "@adrikesteren/relay-client";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { resolveWorkerCronSecret } from "@/lib/workers/resolve-worker-cron-secret";

export const RELAY_POLL_MS = 1000;
/** Max wait when chaining message-groups (exchange-close). */
export const RELAY_CHUNK_WAIT_MAX_MS = 3_600_000;

/** Per-message `timeout` (seconds) for Relay `historical-executor-replay` jobs — 30 minutes. */
export const RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S = 30 * 60;

/** Per-message `timeout` (seconds) for Relay `market-backfill-candles` jobs — 15 minutes. */
export const RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S = 60 * 15;

/** Per-message `timeout` (seconds) for Relay `market-backfill-signals` jobs — 15 minutes. */
export const RELAY_MARKET_BACKFILL_SIGNALS_TIMEOUT_S = 60 * 15;

/**
 * Create a `@adrikesteren/relay-client` instance from `RELAY_APP_URL` + `RELAY_APP_SECRET`.
 * Throws when either env var is missing — callers should branch on
 * {@link isRelayWorkerEnqueueConfigured} when the inline fallback is acceptable.
 */
export function makeRelayClient(): RelayClient {
  loadMonorepoDotenvOnce();
  const baseUrl = process.env.RELAY_APP_URL?.trim();
  const apiKey = process.env.RELAY_APP_SECRET?.trim();
  if (!baseUrl) {
    throw new Error("RELAY_APP_URL is not set (required for Relay enqueue)");
  }
  if (!apiKey) {
    throw new Error("RELAY_APP_SECRET is not set (Relay ingress Bearer)");
  }
  return new RelayClient({ baseUrl, apiKey });
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
 * Worker URL for one "Backfill candles" market chunk (Ingest Agent over a UTC window).
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
 * Worker URL for one "Backfill signals" market chunk (Signal Agent smart-fill over a UTC window).
 * `endDate` is optional — leave empty to fill up to today.
 */
export function buildMarketBackfillSignalsWorkerUrl(
  appBase: string,
  args: { marketId: string; startDate: string; endDate?: string | null },
): string {
  const u = new URL(`${appBase.replace(/\/$/, "")}/api/workers/market-backfill-signals`);
  u.searchParams.set("marketId", args.marketId.trim());
  u.searchParams.set("startDate", args.startDate.trim());
  const end = (args.endDate ?? "").trim();
  if (end) u.searchParams.set("endDate", end);
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

/** Split a downstream URL into the `{ origin, path }` shape the SDK expects. */
export function toRelayOriginAndPath(targetUrl: string): { origin: string; path: string } {
  const u = new URL(targetUrl);
  return { origin: u.origin, path: `${u.pathname}${u.search}` };
}

/** Same as {@link toRelayOriginAndPath} for an array — enforces a single shared origin (SDK shared shape). */
export function toRelayOriginAndPaths(targetUrls: string[]): { origin: string; paths: string[] } {
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

/**
 * Polls `relay.messages.get` every {@link RELAY_POLL_MS} until the message reaches a terminal state
 * (`delivered` / `dead` / `cancelled`) or {@link RELAY_CHUNK_WAIT_MAX_MS} elapses.
 */
export async function waitForRelayMessageTerminal(
  relay: RelayClient,
  messageId: string,
): Promise<{ id: string; status: "delivered" | "dead" | "cancelled" }> {
  const deadline = Date.now() + RELAY_CHUNK_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    const { message } = await relay.messages.get(messageId);
    if (message.status === "delivered" || message.status === "dead" || message.status === "cancelled") {
      return { id: message.id, status: message.status };
    }
    await new Promise((r) => setTimeout(r, RELAY_POLL_MS));
  }
  throw new Error(
    `Timed out after ${RELAY_CHUNK_WAIT_MAX_MS}ms waiting for Relay message ${messageId} to finish (is Relay dispatch running?)`,
  );
}
