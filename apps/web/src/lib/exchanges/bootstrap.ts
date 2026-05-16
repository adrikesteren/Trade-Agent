import "server-only";

import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import { bitvavoAdapter } from "./bitvavo-adapter";
import { hasAdapter, registerAdapter } from "./exchange-adapter-registry";

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

/**
 * Idempotently register all built-in exchange adapters. Safe to call from any server
 * entry point; concurrent callers share the same in-flight promise.
 */
export async function ensureExchangeAdaptersBootstrapped(): Promise<void> {
  if (bootstrapped) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const admin = createServiceRoleClient();
    const bitvavoId = await ExchangesSelector.selectIdByCode(admin, "bitvavo");
    if (!hasAdapter(bitvavoId)) registerAdapter(bitvavoId, bitvavoAdapter);
    bootstrapped = true;
  })();
  try {
    await bootstrapPromise;
  } catch (err) {
    // Reset so a subsequent call can retry after transient failures (e.g. DB hiccup).
    bootstrapped = false;
    bootstrapPromise = null;
    throw err;
  }
}
