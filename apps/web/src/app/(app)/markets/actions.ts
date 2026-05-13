"use server";

import { createClient } from "@/lib/supabase/server";

export type DeleteCatalogMarketResult = { ok: true } | { ok: false; error: string };

/**
 * Catalog markets are exchange-synced and referenced by trading data; the dashboard does not delete them.
 */
export async function deleteCatalogMarket(_marketId: string): Promise<DeleteCatalogMarketResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }
  return {
    ok: false,
    error: "Deleting catalog markets is not supported. Listings are managed by exchange sync.",
  };
}
