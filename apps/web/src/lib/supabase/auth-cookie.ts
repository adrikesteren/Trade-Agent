/**
 * Distinct auth cookie storage for this app when multiple Next.js apps on **localhost**
 * (different ports) share one Supabase project. Cookies are scoped by hostname only, so
 * `localhost:3000` and `localhost:1337` share a jar — each app needs its own
 * `cookieOptions.name` on every `createBrowserClient` / `createServerClient` from
 * `@supabase/ssr`, or logins overwrite each other. Log out with `signOut({ scope: "local" })`
 * so only this tab's session ends; the default global sign-out revokes all sessions for the user.
 */
export const supabaseAuthCookieOptions = {
  name: "trade-sb-auth",
  path: "/",
} as const;
