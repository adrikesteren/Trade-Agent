import "server-only";

import { ACTIVE_APP_COOKIE_NAME, type AppMetadata } from "@adrikesteren/adricore/metadata";
import { cookies } from "next/headers";

import {
  getActiveAppMetadata,
  resolveActiveAppId,
  type DashboardAppId,
} from "@/config/app-shell";

export type ResolvedDashboardApp = {
  appId: DashboardAppId;
  app: AppMetadata;
};

/**
 * Reads `ACTIVE_APP_COOKIE_NAME`, validates against `appRegistry`, falls back to `DEFAULT_APP_ID`.
 */
export async function getDashboardActiveApp(): Promise<ResolvedDashboardApp> {
  const jar = await cookies();
  const raw = jar.get(ACTIVE_APP_COOKIE_NAME)?.value;
  const appId = resolveActiveAppId(raw);
  return { appId, app: getActiveAppMetadata(appId) };
}
