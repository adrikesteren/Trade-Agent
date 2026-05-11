import "server-only";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";

/** Public origin for absolute worker URLs (no trailing slash). */
export function getAppBaseUrl(): string {
  loadMonorepoDotenvOnce();
  const raw = process.env.APP_URL?.trim();
  if (!raw) {
    throw new Error("APP_URL is not set (required for worker URLs enqueued on Relay)");
  }
  return raw.replace(/\/$/, "");
}
