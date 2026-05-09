import Link from "next/link";

/** Columns on `catalog.assets` filled by CoinGecko sync (subset used by UI). */
export type AssetLiveCoingeckoDb = {
  coingecko_fetched_at: string | null;
  coingecko_coin_id: string | null;
  coingecko_price_usd: number | string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_fdv_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
  coingecko_high_24h_usd: number | string | null;
  coingecko_low_24h_usd: number | string | null;
  coingecko_price_change_24h_usd: number | string | null;
  coingecko_price_change_24h_pct: number | string | null;
  coingecko_price_change_7d_pct: number | string | null;
  coingecko_market_cap_rank: number | null;
  coingecko_circulating_supply: number | string | null;
  coingecko_total_supply: number | string | null;
  coingecko_max_supply: number | string | null;
  coingecko_ath_usd: number | string | null;
  coingecko_ath_change_pct: number | string | null;
};

/** Live CoinGecko fields stored on `catalog.assets` (updated each sync). */
export type AssetCoingeckoMetricsRow = {
  fetched_at: string;
  coingecko_id: string;
  price_usd: number | string | null;
  market_cap_usd: number | string | null;
  fully_diluted_valuation_usd: number | string | null;
  total_volume_usd: number | string | null;
  high_24h_usd: number | string | null;
  low_24h_usd: number | string | null;
  price_change_24h_usd: number | string | null;
  price_change_24h_pct: number | string | null;
  price_change_7d_pct: number | string | null;
  market_cap_rank: number | null;
  circulating_supply: number | string | null;
  total_supply: number | string | null;
  max_supply: number | string | null;
  ath_usd: number | string | null;
  ath_change_pct: number | string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function fmtUsd(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(n) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2,
  }).format(n);
}

function fmtUsdDelta(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return String(Math.round(v));
}

function fmtSupply(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function buildAssetCoingeckoMetricsRow(
  asset: AssetLiveCoingeckoDb,
  metadataCoingeckoId: string | null,
): AssetCoingeckoMetricsRow | null {
  if (!asset.coingecko_fetched_at) return null;
  const cgId = asset.coingecko_coin_id?.trim() || metadataCoingeckoId?.trim() || "—";
  return {
    fetched_at: asset.coingecko_fetched_at,
    coingecko_id: cgId,
    price_usd: asset.coingecko_price_usd,
    market_cap_usd: asset.coingecko_market_cap_usd,
    fully_diluted_valuation_usd: asset.coingecko_fdv_usd,
    total_volume_usd: asset.coingecko_total_volume_usd,
    high_24h_usd: asset.coingecko_high_24h_usd,
    low_24h_usd: asset.coingecko_low_24h_usd,
    price_change_24h_usd: asset.coingecko_price_change_24h_usd,
    price_change_24h_pct: asset.coingecko_price_change_24h_pct,
    price_change_7d_pct: asset.coingecko_price_change_7d_pct,
    market_cap_rank: asset.coingecko_market_cap_rank,
    circulating_supply: asset.coingecko_circulating_supply,
    total_supply: asset.coingecko_total_supply,
    max_supply: asset.coingecko_max_supply,
    ath_usd: asset.coingecko_ath_usd,
    ath_change_pct: asset.coingecko_ath_change_pct,
  };
}

function fmtUtcShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50/80 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function metricsStatGrid(row: AssetCoingeckoMetricsRow) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Price" value={fmtUsd(row.price_usd)} />
      <Stat label="24h Δ (USD)" value={fmtUsdDelta(row.price_change_24h_usd)} />
      <Stat label="Market cap" value={fmtUsd(row.market_cap_usd)} />
      <Stat label="24h volume" value={fmtUsd(row.total_volume_usd)} />
      <Stat label="FDV" value={fmtUsd(row.fully_diluted_valuation_usd)} />
      <Stat label="24h high / low" value={`${fmtUsd(row.high_24h_usd)} / ${fmtUsd(row.low_24h_usd)}`} />
      <Stat label="24h / 7d %" value={`${fmtPct(row.price_change_24h_pct)} / ${fmtPct(row.price_change_7d_pct)}`} />
      <Stat label="Rank (mcap)" value={fmtInt(row.market_cap_rank)} />
      <Stat label="Circ. / total / max supply" value={`${fmtSupply(row.circulating_supply)} · ${fmtSupply(row.total_supply)} · ${fmtSupply(row.max_supply)}`} />
      <Stat label="ATH / vs ATH" value={`${fmtUsd(row.ath_usd)} · ${fmtPct(row.ath_change_pct)}`} />
    </dl>
  );
}

export function AssetCoingeckoMetricsBlock({
  row,
  assetCode,
}: {
  row: AssetCoingeckoMetricsRow;
  assetCode: string;
}) {
  const cgUrl = `https://www.coingecko.com/en/coins/${encodeURIComponent(row.coingecko_id)}`;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">CoinGecko (USD)</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Live fields on <span className="font-mono text-zinc-700 dark:text-zinc-300">{assetCode}</span> (updated each
            CoinGecko sync): cap, volume, supply, ATH, and % moves.
          </p>
        </div>
        <Link
          href={cgUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          Open on CoinGecko ↗
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Fetched <span className="font-mono text-zinc-700 dark:text-zinc-300">{fmtUtcShort(row.fetched_at)}</span>
        <span className="mx-1.5">·</span>
        <span className="font-mono">id: {row.coingecko_id}</span>
      </p>
      {metricsStatGrid(row)}
    </section>
  );
}

/** Same layout as a real snapshot, but no DB row yet — makes clear which fields will appear after sync. */
export function AssetCoingeckoMetricsNoSnapshot({
  assetCode,
  resolvedCoingeckoId,
}: {
  assetCode: string;
  resolvedCoingeckoId: string | null;
}) {
  const dashRow: AssetCoingeckoMetricsRow = {
    fetched_at: "",
    coingecko_id: resolvedCoingeckoId ?? "—",
    price_usd: null,
    market_cap_usd: null,
    fully_diluted_valuation_usd: null,
    total_volume_usd: null,
    high_24h_usd: null,
    low_24h_usd: null,
    price_change_24h_usd: null,
    price_change_24h_pct: null,
    price_change_7d_pct: null,
    market_cap_rank: null,
    circulating_supply: null,
    total_supply: null,
    max_supply: null,
    ath_usd: null,
    ath_change_pct: null,
  };

  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">CoinGecko (USD)</h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            No live CoinGecko data on <span className="font-mono font-medium">{assetCode}</span> yet. Run{" "}
            <strong>Asset fundamentals (USD)</strong> from Sync runs — then the same row in{" "}
            <code className="rounded bg-zinc-200/80 px-1 dark:bg-zinc-800">assets</code> is filled (no duplicate history
            rows).
          </p>
        </div>
        <Link
          href="/dashboard/sync-runs"
          className="shrink-0 text-xs font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          Sync runs →
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Catalog id:{" "}
        <span className="font-mono text-zinc-700 dark:text-zinc-300">{resolvedCoingeckoId ?? "not resolved"}</span>
        {!resolvedCoingeckoId ? (
          <span className="ml-1 text-zinc-400">
            — the worker resolves ids via search (max per run). Run sync again if you just added the asset.
          </span>
        ) : null}
      </p>
      <div className="text-zinc-500/90">{metricsStatGrid(dashRow)}</div>
    </section>
  );
}

export function AssetCoingeckoMetricsPlaceholder({ reason }: { reason: "non_crypto" | "no_data" }) {
  const copy =
    reason === "non_crypto"
      ? "CoinGecko live fields are only collected for crypto assets in the catalog."
      : "No live CoinGecko data yet. Use Sync runs (worker or local ENABLE_LOCAL_COINGECKO_METRICS_SYNC).";

  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">CoinGecko (USD)</h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{copy}</p>
    </section>
  );
}
