import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { loadMonorepoDotenvOnce } from "@/lib/env/load-monorepo-dotenv-once";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookie";

export async function POST(request: Request) {
  loadMonorepoDotenvOnce();
  const cookieStore = await cookies();
  const base = new URL(request.url).origin;
  const response = NextResponse.redirect(new URL("/login", base));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) {
    return NextResponse.json({ error: "missing_supabase_env" }, { status: 503 });
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookieOptions: supabaseAuthCookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.signOut({ scope: "local" });
  return response;
}
