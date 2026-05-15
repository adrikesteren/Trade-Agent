import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

import { loadMonorepoDotenvOnce } from "./src/lib/env/load-monorepo-dotenv-once";

/**
 * Next default `.env` is under `apps/web`; this monorepo keeps secrets in the repo root.
 * Load those files first (also used by Turbopack middleware / server chunks that miss `process.env`).
 */
loadMonorepoDotenvOnce();

/** Directory containing this `next.config` file (= `apps/web`). */
const webRoot = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: one level above `apps/web`. */
const monorepoRoot = path.resolve(webRoot, "..");

/** Read after `loadMonorepoDotenvOnce()` so repo-root `.env` is applied before `env` inlining. */
const nextPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const nextPublicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

const nextConfig: NextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/overview", permanent: true },
      { source: "/dashboard/:path*", destination: "/:path*", permanent: true },
    ];
  },
  transpilePackages: ["@adrikesteren/adricore", "@repo/exchange", "@repo/risk", "@repo/trading"],
  /**
   * Inlines into Edge middleware and the browser bundle. `loadMonorepoDotenvOnce()` must run above
   * so these are non-empty when values only exist in the monorepo root `.env`.
   */
  env: {
    NEXT_PUBLIC_SUPABASE_URL: nextPublicSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: nextPublicSupabaseAnonKey,
  },
};

export default nextConfig;
