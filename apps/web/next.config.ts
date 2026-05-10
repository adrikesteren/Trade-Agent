import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Next loads `.env` from `apps/web` by default; in this monorepo secrets often live at repo root.
 * Load root then optional overrides (later wins).
 */
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(webRoot, "..", "..");

// `override: true` so repo `.env` wins over stray OS/user env (e.g. old SIGNAL_DEFAULT_USER_ID in Windows).
dotenv.config({ path: path.join(monorepoRoot, ".env"), override: true });
dotenv.config({ path: path.join(monorepoRoot, ".env.local"), override: true });
dotenv.config({ path: path.join(webRoot, ".env.local"), override: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/blocks", "@repo/exchange", "@repo/redis", "@repo/risk", "@repo/trading"],
};

export default nextConfig;
