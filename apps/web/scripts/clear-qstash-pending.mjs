/**
 * Cancel all **pending** QStash messages for this token (EUR sweep continuations, CoinGecko chains, etc.).
 *
 * Usage (from `apps/web`):
 *   pnpm qstash:clear-pending
 *
 * Loads env like `next.config.ts`: repo root `.env`, `.env.local`, then `apps/web/.env`, `.env.local`, each with
 * `override: true` so file values beat stray OS/shell variables. Matches `next dev` / deployment layouts.
 *
 * Optional: also remove QStash **schedules** (recurring jobs in the Upstash project):
 *   CLEAR_QSTASH_SCHEDULES=1 pnpm qstash:clear-pending
 * To (re)create managed schedules after that, use `pnpm qstash:schedules` (see `scripts/qstash-schedules.mjs`).
 *
 * Note: messages already in flight to your API may still be delivered once.
 *
 * @see https://upstash.com/docs/qstash/api-reference/messages/bulk-cancel-messages
 */
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@upstash/qstash";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, "../../../.env");
const rootEnvLocal = resolve(__dirname, "../../../.env.local");
const webEnv = resolve(__dirname, "../.env");
const webEnvLocal = resolve(__dirname, "../.env.local");

const envChain = [
  { path: rootEnv },
  { path: rootEnvLocal },
  { path: webEnv },
  { path: webEnvLocal },
];
for (const { path } of envChain) {
  if (existsSync(path)) dotenv.config({ path, override: true });
}

const token = process.env.QSTASH_TOKEN;
if (!token?.trim()) {
  console.error("Missing QSTASH_TOKEN (set in env or .env).");
  process.exit(1);
}

const client = new Client({ token });

let total = 0;
for (;;) {
  const { cancelled } = await client.messages.cancel({ all: true, count: 500 });
  total += cancelled;
  console.log(`cancelled batch: ${cancelled} (running total: ${total})`);
  if (cancelled === 0) break;
}

console.log(`Done. Pending messages cancelled: ${total}.`);

if (process.env.CLEAR_QSTASH_SCHEDULES === "1") {
  const schedules = await client.schedules.list();
  for (const s of schedules) {
    await client.schedules.delete(s.scheduleId);
    console.log(`deleted schedule: ${s.scheduleId} → ${s.destination}`);
  }
  console.log(`Schedules removed: ${schedules.length}.`);
}
