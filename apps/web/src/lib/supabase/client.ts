import { createBrowserClient } from "@supabase/ssr";

import { supabaseAuthCookieOptions } from "./auth-cookie";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (browser bundle). Restart `pnpm dev` after setting them in repo-root `.env`; see `next.config.ts` `env`.",
    );
  }
  return createBrowserClient(
    url,
    anonKey,
    { cookieOptions: supabaseAuthCookieOptions },
  );
}
