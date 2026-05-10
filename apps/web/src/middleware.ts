import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Worker routes authenticate with `Authorization: Bearer CRON_SECRET` only. Skip Supabase
  // session refresh here so @supabase/ssr does not clone/rewrite the request (which can drop
  // or alter headers before the Route Handler runs).
  if (request.nextUrl.pathname.startsWith("/api/workers")) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
