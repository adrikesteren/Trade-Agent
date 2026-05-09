/**
 * Manage QStash **Schedules** (recurring signed POSTs) for Trade Agent worker routes.
 *
 * Prereqs in `.env` (repo root or `apps/web`, same as `qstash:clear-pending`):
 *   - QSTASH_TOKEN
 *   - APP_BASE_URL or NEXT_PUBLIC_APP_URL — public **https** origin QStash will call (must match
 *     signing verification: see `workerPublicBaseUrl` + `qstashSigningUrl`).
 *
 * Commands (from `apps/web`):
 *   pnpm qstash:schedules              → upsert managed schedules (default)
 *   pnpm qstash:schedules:list         → list all schedules in the QStash project
 *   pnpm qstash:schedules:delete       → delete only the managed schedule IDs below
 *   pnpm qstash:schedules:pause        → pause managed schedules
 *   pnpm qstash:schedules:resume       → resume managed schedules
 *
 * Cron expressions are interpreted by QStash (UTC). Defaults align with dashboard defaults (5m).
 * Override per job or globally:
 *   QSTASH_DEFAULT_CRON — if unset, the script uses the same 5-minute cadence as `sync-schedule` defaults (see `defaultCron()`).
 *   QSTASH_CRON_BITVAVO_CANDLES, QSTASH_CRON_BITVAVO_MARKETS, QSTASH_CRON_COINGECKO_METRICS, QSTASH_CRON_COINGECKO_COIN_ID
 *   Jobs without QSTASH_DEFAULT_CRON use their own fallback (e.g. markets = hourly UTC).
 *
 * Each schedule uses a stable `scheduleId` so re-running **upsert** updates the same schedule.
 *
 * @see https://upstash.com/docs/qstash/features/schedules
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

const ENV_FILES = [
  { path: rootEnv, label: "repo root .env" },
  { path: rootEnvLocal, label: "repo root .env.local" },
  { path: webEnv, label: "apps/web .env" },
  { path: webEnvLocal, label: "apps/web .env.local" },
];

for (const { path } of ENV_FILES) {
  if (existsSync(path)) dotenv.config({ path });
}

function printEnvDiagnostics() {
  console.error("Checked these files (in order; later files override earlier):");
  for (const { path, label } of ENV_FILES) {
    console.error(`  [${existsSync(path) ? "found" : "absent"}] ${label}`);
    console.error(`           ${path}`);
  }
  const raw = process.env.QSTASH_TOKEN;
  console.error(
    `QSTASH_TOKEN after load: ${raw === undefined ? "undefined" : raw === "" ? "empty string" : `set (${raw.trim().length} chars trimmed)`}`,
  );
}

/** Stable IDs — do not rename without migrating in the Upstash console. */
const MANAGED = [
  {
    scheduleId: "trade-agent-bitvavo-candles-eur",
    path: "/api/workers/bitvavo-candles-sync",
    label: "trade-agent.bitvavo-candles-eur",
    cronEnv: "QSTASH_CRON_BITVAVO_CANDLES",
  },
  {
    scheduleId: "trade-agent-bitvavo-markets-eur",
    path: "/api/workers/bitvavo-markets-sync",
    label: "trade-agent.bitvavo-markets-eur",
    cronEnv: "QSTASH_CRON_BITVAVO_MARKETS",
    fallbackCron: "0 * * * *",
  },
  {
    scheduleId: "trade-agent-coingecko-metrics",
    path: "/api/workers/coingecko-metrics-sync",
    label: "trade-agent.coingecko-metrics",
    cronEnv: "QSTASH_CRON_COINGECKO_METRICS",
  },
  {
    scheduleId: "trade-agent-coingecko-coin-id",
    path: "/api/workers/coingecko-coin-id-sync",
    label: "trade-agent.coingecko-coin-id",
    cronEnv: "QSTASH_CRON_COINGECKO_COIN_ID",
  },
];

function publicBaseUrl() {
  const u = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL;
  if (!v) return null;
  const trimmed = v.replace(/^https?:\/\//, "");
  return `https://${trimmed}`.replace(/\/$/, "");
}

function defaultCron() {
  const c = process.env.QSTASH_DEFAULT_CRON?.trim();
  return c && c.length > 0 ? c : "*/5 * * * *";
}

function cronFor(entry) {
  const override = process.env[entry.cronEnv]?.trim();
  if (override && override.length > 0) return override;
  if (entry.fallbackCron) return entry.fallbackCron;
  return defaultCron();
}

async function cmdUpsert() {
  const token = process.env.QSTASH_TOKEN;
  const base = publicBaseUrl();
  if (!token?.trim()) {
    console.error("Missing QSTASH_TOKEN (script did not see it in process.env).");
    printEnvDiagnostics();
    console.error(
      "\nTip: run from apps/web (`pnpm qstash:schedules`) and put QSTASH_TOKEN in repo-root `.env` or `apps/web/.env` (or `.env.local`).",
    );
    process.exit(1);
  }
  if (!base || !/^https:\/\//i.test(base)) {
    console.error(
      "Missing or invalid APP_BASE_URL / NEXT_PUBLIC_APP_URL (must be https, no trailing slash). QStash must reach this origin.",
    );
    printEnvDiagnostics();
    process.exit(1);
  }

  const client = new Client({ token });
  const defCron = defaultCron();

  for (const s of MANAGED) {
    const cron = cronFor(s);
    const destination = `${base}${s.path}`;
    const { scheduleId } = await client.schedules.create({
      scheduleId: s.scheduleId,
      destination,
      cron,
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
      retries: 3,
      label: s.label,
    });
    console.log(`upserted schedule ${scheduleId}`);
    console.log(`  → ${destination}`);
    const cronSrc = process.env[s.cronEnv]
      ? s.cronEnv
      : s.fallbackCron
        ? `fallback ${s.fallbackCron}`
        : `QSTASH_DEFAULT_CRON=${defCron}`;
    console.log(`  cron: ${cron} (${cronSrc})`);
  }
  console.log("\nDone. Deliveries are signed QStash POSTs (set QSTASH_* signing keys on the app).");
}

async function cmdList() {
  const token = process.env.QSTASH_TOKEN;
  if (!token?.trim()) {
    console.error("Missing QSTASH_TOKEN (script did not see it in process.env).");
    printEnvDiagnostics();
    process.exit(1);
  }
  const client = new Client({ token });
  const list = await client.schedules.list();
  if (list.length === 0) {
    console.log("No schedules in this QStash project.");
    return;
  }
  for (const sch of list) {
    const managed = MANAGED.some((m) => m.scheduleId === sch.scheduleId);
    console.log(
      `${sch.scheduleId}${managed ? " [managed]" : ""}  paused=${sch.isPaused}  cron=${sch.cron}  → ${sch.destination}`,
    );
  }
}

async function cmdDelete() {
  const token = process.env.QSTASH_TOKEN;
  if (!token?.trim()) {
    console.error("Missing QSTASH_TOKEN (script did not see it in process.env).");
    printEnvDiagnostics();
    process.exit(1);
  }
  const client = new Client({ token });
  for (const s of MANAGED) {
    try {
      await client.schedules.delete(s.scheduleId);
      console.log(`deleted ${s.scheduleId}`);
    } catch (e) {
      const status = typeof e === "object" && e && "status" in e ? Number((e).status) : NaN;
      const msg = e instanceof Error ? e.message : String(e);
      if (status === 404 || /404|not found/i.test(msg)) {
        console.log(`skip ${s.scheduleId} (not found)`);
      } else {
        throw e;
      }
    }
  }
  console.log("Done.");
}

async function cmdPause() {
  const token = process.env.QSTASH_TOKEN;
  if (!token?.trim()) {
    console.error("Missing QSTASH_TOKEN (script did not see it in process.env).");
    printEnvDiagnostics();
    process.exit(1);
  }
  const client = new Client({ token });
  for (const s of MANAGED) {
    await client.schedules.pause({ schedule: s.scheduleId });
    console.log(`paused ${s.scheduleId}`);
  }
  console.log("Done.");
}

async function cmdResume() {
  const token = process.env.QSTASH_TOKEN;
  if (!token?.trim()) {
    console.error("Missing QSTASH_TOKEN (script did not see it in process.env).");
    printEnvDiagnostics();
    process.exit(1);
  }
  const client = new Client({ token });
  for (const s of MANAGED) {
    await client.schedules.resume({ schedule: s.scheduleId });
    console.log(`resumed ${s.scheduleId}`);
  }
  console.log("Done.");
}

const cmd = (process.argv[2] ?? "upsert").toLowerCase();
const runners = {
  upsert: cmdUpsert,
  list: cmdList,
  delete: cmdDelete,
  pause: cmdPause,
  resume: cmdResume,
};

const run = runners[cmd];
if (!run) {
  console.error(`Unknown command: ${cmd}. Use: upsert | list | delete | pause | resume`);
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
