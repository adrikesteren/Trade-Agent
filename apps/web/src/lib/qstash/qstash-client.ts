import "server-only";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { Client } from "@upstash/qstash";

/** Public origin for publish URLs and optional signature URL binding (no trailing slash). */
export function getAppBaseUrl(): string {
  loadMonorepoDotenvOnce();
  const raw = process.env.APP_URL?.trim();
  if (!raw) {
    throw new Error("APP_URL is not set (required for QStash publish targets)");
  }
  return raw.replace(/\/$/, "");
}

export function createQstashClient(): Client {
  loadMonorepoDotenvOnce();
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    throw new Error("QSTASH_TOKEN is not set");
  }
  const baseUrl = process.env.QSTASH_URL?.trim();
  return baseUrl ? new Client({ token, baseUrl }) : new Client({ token });
}
