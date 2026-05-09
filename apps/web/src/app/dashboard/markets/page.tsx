import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type MarketListingRow = {
  id: string;
  exchange_id: string;
  asset_id: string;
  market_symbol: string;
  quote_code: string | null;
  status: string | null;
  metadata: unknown;
  assets: unknown;
  exchanges: unknown;
};

export default async function MarketsIndexPage() {
  const supabase = await createClient();

  const { data: exchange } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .eq("code", "bitvavo")
    .maybeSingle();

  const { data: listings, error } = exchange
    ? await supabase
        .schema("catalog")
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
        .limit(500)
    : { data: null, error: null };

  const rows = (listings ?? []) as MarketListingRow[];
  const assetIds = [...new Set(rows.map((r) => r.asset_id).filter(Boolean))] as string[];

  const mcapByAsset = new Map<string, number>();
  if (assetIds.length > 0) {
    const { data: mcapRows, error: mcapErr } = await supabase.rpc("latest_market_cap_by_assets", {
      _asset_ids: assetIds,
    });
    if (!mcapErr && mcapRows) {
      for (const r of mcapRows as { asset_id: string; market_cap_usd: number | string | null }[]) {
        if (r.asset_id == null || r.market_cap_usd == null) continue;
        const n = typeof r.market_cap_usd === "number" ? r.market_cap_usd : Number(r.market_cap_usd);
        if (Number.isFinite(n)) mcapByAsset.set(r.asset_id, n);
      }
    }
  }

  const sortedListings = [...rows].sort((a, b) => {
    const na = mcapByAsset.get(a.asset_id) ?? Number.NEGATIVE_INFINITY;
    const nb = mcapByAsset.get(b.asset_id) ?? Number.NEGATIVE_INFINITY;
    if (nb !== na) return nb - na;
    return (a.market_symbol ?? "").localeCompare(b.market_symbol ?? "", undefined, { sensitivity: "base" });
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Markets</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Tradable pairs (e.g. BTC-EUR). Base assets live under{" "}
            <Link href="/dashboard/assets" className="font-medium underline-offset-2 hover:underline">
              Assets
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Link
            href="/dashboard/sync-runs"
            className="text-sm font-medium text-zinc-800 underline-offset-4 hover:underline dark:text-zinc-200"
          >
            Sync runs
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      <section className="rounded-md border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">Jobs & history</span> — Bitvavo sync (listings
        + candles), CoinGecko snapshots, and{" "}
        <code className="rounded bg-zinc-200/80 px-1 text-xs dark:bg-zinc-800">sync_runs</code> on{" "}
        <Link href="/dashboard/sync-runs" className="font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400">
          Sync runs
        </Link>
        .
      </section>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Bitvavo EUR listings{" "}
          {sortedListings.length ? `(${sortedListings.length} shown, max 500, by asset market cap ↓)` : ""}
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
              {sortedListings.map((row) => {
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
                          href={`/dashboard/exchanges/${exchangeId}`}
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
                        href={`/dashboard/markets/${row.id}`}
                        className="text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                      >
                        {row.market_symbol}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {assetId ? (
                        <Link
                          href={`/dashboard/assets/${assetId}`}
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
              {!sortedListings.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No listings yet. Open{" "}
                    <Link href="/dashboard/sync-runs" className="font-medium underline-offset-2 hover:underline">
                      Sync runs
                    </Link>{" "}
                    and use <strong>Sync now</strong> for markets.
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
