import { BitvavoSyncStatusPanel } from "@/components/bitvavo-sync-status-panel";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
} from "@/lib/markets/record-bitvavo-sync-status";
import { getCandlesSyncIntervalMs, getMarketsSyncIntervalMs } from "@/lib/markets/sync-schedule";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AssetsPage() {
  const supabase = await createClient();

  const { data: syncRows, error: syncStatusError } = await supabase
    .from("bitvavo_sync_status")
    .select("job_key, last_success_at")
    .in("job_key", [BITVAVO_SYNC_JOB_MARKETS_EUR, BITVAVO_SYNC_JOB_CANDLES_EUR]);

  const syncSafe = syncStatusError ? [] : (syncRows ?? []);
  const marketsLast =
    syncSafe.find((r) => r.job_key === BITVAVO_SYNC_JOB_MARKETS_EUR)?.last_success_at ?? null;
  const candlesLast =
    syncSafe.find((r) => r.job_key === BITVAVO_SYNC_JOB_CANDLES_EUR)?.last_success_at ?? null;

  const { data: exchange } = await supabase
    .from("exchanges")
    .select("id, code, name")
    .eq("code", "bitvavo")
    .maybeSingle();

  const { data: listings, error } = exchange
    ? await supabase
        .from("markets")
        .select(
          `
          id,
          exchange_id,
          asset_id,
          market_symbol,
          quote_code,
          status,
          metadata,
          assets ( id, code, kind, name ),
          exchanges ( id, code, name )
        `,
        )
        .eq("exchange_id", exchange.id)
        .order("market_symbol", { ascending: true })
        .limit(500)
    : { data: null, error: null };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Markets & assets</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Each row is one <strong>tradable pair</strong> on an exchange (e.g. BTC-EUR). The underlying{" "}
            <strong>asset</strong> (e.g. BTC) can later also be a stock — same table, different{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">kind</code>.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          Back to dashboard
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Load listings</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Bitvavo <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/markets</code> fills EUR pairs into the
          database (idempotent upserts). Use <strong>Sync Now</strong> for an immediate market refresh. Candle OHLCV is
          kept in sync automatically in the background; retention follows your catalog settings.
        </p>
        <div className="mt-4">
          <BitvavoSyncStatusPanel
            marketsLastSuccessAt={marketsLast as string | null}
            candlesLastSuccessAt={candlesLast as string | null}
            marketsIntervalMs={getMarketsSyncIntervalMs()}
            candlesIntervalMs={getCandlesSyncIntervalMs()}
          />
        </div>
      </section>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Listings {listings ? `(${listings.length} shown, max 500)` : ""}
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Exchange</th>
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 pr-3">Asset</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Quote</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(listings ?? []).map((row) => {
                const rawA = row.assets as unknown;
                const rawE = row.exchanges as unknown;
                const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as {
                  id?: string;
                  code?: string;
                  kind?: string;
                  name?: string;
                } | null;
                const ex = (Array.isArray(rawE) ? rawE[0] : rawE) as {
                  id?: string;
                  code?: string;
                  name?: string;
                } | null;
                const exchangeId = ex?.id ?? (row as { exchange_id?: string }).exchange_id;
                const assetId = asset?.id ?? (row as { asset_id?: string }).asset_id;
                return (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      {exchangeId ? (
                        <Link
                          href={`/dashboard/assets/exchanges/${exchangeId}`}
                          className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                        >
                          {ex?.code ?? "—"}
                        </Link>
                      ) : (
                        ex?.code ?? "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      <Link
                        href={`/dashboard/assets/markets/${row.id}`}
                        className="text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                      >
                        {row.market_symbol}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {assetId ? (
                        <Link
                          href={`/dashboard/assets/asset/${assetId}`}
                          className="text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                        >
                          {asset?.code ?? "—"}
                        </Link>
                      ) : (
                        asset?.code ?? "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{asset?.kind ?? "—"}</td>
                    <td className="py-2 pr-3">{row.quote_code ?? "—"}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                  </tr>
                );
              })}
              {!listings?.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No listings yet. Use <strong>Sync Now</strong> above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
