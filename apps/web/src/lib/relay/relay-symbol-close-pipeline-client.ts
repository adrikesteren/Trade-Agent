import "server-only";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";

export const RELAY_MESSAGE_GROUP_MAX_URLS = 100;
export const RELAY_POLL_MS = 1000;
/** Max wait when chaining message-groups (exchange-close). */
export const RELAY_CHUNK_WAIT_MAX_MS = 3_600_000;

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

export function downstreamWorkerHeaders(): Record<string, string> {
  loadMonorepoDotenvOnce();
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) {
    throw new Error("CRON_SECRET is not set (required in Relay job headers for worker auth)");
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

export async function postRelaySingleMessage(
  relayBase: string,
  url: string,
  headers: Record<string, string>,
  maxRetries: number,
): Promise<string> {
  const res = await fetch(`${relayBase}/api/v1/messages`, {
    method: "POST",
    headers: relayIngressPostHeaders(),
    body: JSON.stringify({ url, method: "POST", headers, maxRetries }),
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
  const res = await fetch(`${relayBase}/api/v1/message-group`, {
    method: "POST",
    headers: relayIngressPostHeaders(),
    body: JSON.stringify({ urls, method: "POST", headers, maxRetries }),
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
  if (!groupId || messageIds.length !== urls.length) {
    throw new Error("Relay /message-group response missing message_group.id or message ids");
  }
  return { groupId, messageIds };
}
