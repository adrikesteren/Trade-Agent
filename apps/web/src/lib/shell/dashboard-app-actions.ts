"use server";

import { ACTIVE_APP_COOKIE_NAME } from "@repo/adricore/metadata";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { appRegistry, type DashboardAppId } from "@/config/app-shell";
import { getDashboardSession } from "@/lib/supabase/dashboard-session";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;

export async function selectDashboardApp(appId: DashboardAppId): Promise<{ ok: boolean }> {
  const { user } = await getDashboardSession();
  if (!user) {
    return { ok: false };
  }
  if (!Object.hasOwn(appRegistry, appId)) {
    return { ok: false };
  }
  const jar = await cookies();
  jar.set(ACTIVE_APP_COOKIE_NAME, appId, {
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
