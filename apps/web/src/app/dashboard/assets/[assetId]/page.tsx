import {
  AssetCoingeckoMetricsBlock,
  AssetCoingeckoMetricsNoSnapshot,
  AssetCoingeckoMetricsPlaceholder,
  buildAssetCoingeckoMetricsRow,
  type AssetLiveCoingeckoDb,
} from "@/components/asset-coingecko-metrics-block";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ assetId: string }> };

const ASSET_CG_FIELDS =
  "coingecko_fetched_at, coingecko_coin_id, coingecko_price_usd, coingecko_market_cap_usd, coingecko_fdv_usd, coingecko_total_volume_usd, coingecko_high_24h_usd, coingecko_low_24h_usd, coingecko_price_change_24h_usd, coingecko_price_change_24h_pct, coingecko_price_change_7d_pct, coingecko_market_cap_rank, coingecko_circulating_supply, coingecko_total_supply, coingecko_max_supply, coingecko_ath_usd, coingecko_ath_change_pct";

export default async function AssetDetailPage({ params }: PageProps) {
  const { assetId } = await params;
  const supabase = await createClient();

  const { data: asset, error } = await supabase
    .from("assets")
    .select(`id, code, kind, name, metadata, created_at, ${ASSET_CG_FIELDS}`)
    .eq("id", assetId)
    .maybeSingle();

  if (error || !asset) {
    notFound();
  }

  const { data: markets } = await supabase
    .from("markets")
    .select(
      `
      id,
      market_symbol,
      quote_code,
      status,
      exchanges ( id, code, name )
    `,
    )
    .eq("asset_id", assetId)
    .order("market_symbol", { ascending: true })
    .limit(100);

  const isCrypto = asset.kind === "crypto";
  const meta =
    asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : {};
  const coingeckoIdHint = typeof meta.coingecko_id === "string" ? meta.coingecko_id : null;

  const cgRow = isCrypto ? buildAssetCoingeckoMetricsRow(asset as AssetLiveCoingeckoDb, coingeckoIdHint) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1">
      <nav className="text-xs text-zinc-500">
        <Link href="/dashboard/assets" className="underline-offset-2 hover:underline">
          Assets
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Detail</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {asset.name ?? asset.code}{" "}
          <span className="font-mono text-lg text-zinc-500">({asset.code})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Kind: <span className="font-medium">{asset.kind}</span> ·{" "}
          {(markets ?? []).length} pair{(markets ?? []).length === 1 ? "" : "s"} · id:{" "}
          <span className="font-mono text-xs">{asset.id}</span>
        </p>
      </div>

      {isCrypto && coingeckoIdHint ? (
        <section className="rounded-md border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">CoinGecko id (catalog)</span>:{" "}
          <span className="font-mono text-zinc-700 dark:text-zinc-300">{coingeckoIdHint}</span>
        </section>
      ) : null}

      {isCrypto && cgRow ? (
        <AssetCoingeckoMetricsBlock row={cgRow} assetCode={asset.code} />
      ) : isCrypto ? (
        <AssetCoingeckoMetricsNoSnapshot assetCode={asset.code} resolvedCoingeckoId={coingeckoIdHint} />
      ) : (
        <AssetCoingeckoMetricsPlaceholder reason="non_crypto" />
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Markets (pairs)</h2>
        <p className="mt-1 text-xs text-zinc-500">Up to 100 listings that use this asset as base.</p>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {(markets ?? []).map((m) => {
            const rawEx = m.exchanges as unknown;
            const ex = (Array.isArray(rawEx) ? rawEx[0] : rawEx) as {
              id?: string;
              code?: string;
              name?: string;
            } | null;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link
                  href={`/dashboard/markets/${m.id}`}
                  className="font-mono font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                >
                  {m.market_symbol}
                </Link>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  {ex?.id ? (
                    <Link
                      href={`/dashboard/exchanges/${ex.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {ex.code ?? "—"}
                    </Link>
                  ) : (
                    <span>{ex?.code ?? "—"}</span>
                  )}
                  <span>·</span>
                  <span>{m.status}</span>
                </div>
              </li>
            );
          })}
          {!markets?.length ? (
            <li className="py-4 text-sm text-zinc-500">No market listings linked yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
