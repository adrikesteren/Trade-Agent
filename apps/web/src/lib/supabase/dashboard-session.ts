import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "./server";

export type DashboardSession = {
  supabase: SupabaseClient;
  user: User | null;
};

/** One `createClient` + `getUser` per dashboard request (layout + page share this). */
export const getDashboardSession = cache(async (): Promise<DashboardSession> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});
