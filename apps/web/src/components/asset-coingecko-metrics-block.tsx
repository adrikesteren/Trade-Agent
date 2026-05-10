import { formatDatetime, formatDecimal, formatPercentSigned, formatUsdAmount, formatUsdSigned } from "@/lib/locale/format";
import type { UserLocalePreferences } from "@/lib/locale/types";
import { Card, CardBody } from "@repo/blocks";
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

function fmtInt(prefs: UserLocalePreferences, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return formatDecimal(Math.round(v), prefs, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function fmtSupply(prefs: UserLocalePreferences, v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  return formatDecimal(n, prefs, { notation: "compact", maximumFractionDigits: 2, minimumFractionDigits: 0 });
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bk-stat-cell">
      <dt className="bk-stat-label">{label}</dt>
      <dd className="bk-stat-value">{value}</dd>
    </div>
  );
}

function metricsStatGrid(row: AssetCoingeckoMetricsRow, prefs: UserLocalePreferences) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Price" value={formatUsdAmount(row.price_usd, prefs, { compactAbove: 1_000_000 })} />
      <Stat label="24h Δ (USD)" value={formatUsdSigned(row.price_change_24h_usd, prefs)} />
      <Stat label="Market cap" value={formatUsdAmount(row.market_cap_usd, prefs, { compactAbove: 1_000_000 })} />
      <Stat label="24h volume" value={formatUsdAmount(row.total_volume_usd, prefs, { compactAbove: 1_000_000 })} />
      <Stat label="FDV" value={formatUsdAmount(row.fully_diluted_valuation_usd, prefs, { compactAbove: 1_000_000 })} />
      <Stat
        label="24h high / low"
        value={`${formatUsdAmount(row.high_24h_usd, prefs)} / ${formatUsdAmount(row.low_24h_usd, prefs)}`}
      />
      <Stat
        label="24h / 7d %"
        value={`${formatPercentSigned(row.price_change_24h_pct, prefs)} / ${formatPercentSigned(row.price_change_7d_pct, prefs)}`}
      />
      <Stat label="Rank (mcap)" value={fmtInt(prefs, row.market_cap_rank)} />
      <Stat
        label="Circ. / total / max supply"
        value={`${fmtSupply(prefs, row.circulating_supply)} · ${fmtSupply(prefs, row.total_supply)} · ${fmtSupply(prefs, row.max_supply)}`}
      />
      <Stat
        label="ATH / vs ATH"
        value={`${formatUsdAmount(row.ath_usd, prefs)} · ${formatPercentSigned(row.ath_change_pct, prefs)}`}
      />
    </dl>
  );
}

export function AssetCoingeckoMetricsBlock({
  row,
  assetCode,
  localePrefs,
}: {
  row: AssetCoingeckoMetricsRow;
  assetCode: string;
  localePrefs: UserLocalePreferences;
}) {
  const cgUrl = `https://www.coingecko.com/en/coins/${encodeURIComponent(row.coingecko_id)}`;

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="bk-form-label" style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              CoinGecko (USD)
            </h2>
            <p className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
              Live fields on <span className="font-mono">{assetCode}</span> (updated each CoinGecko sync): cap, volume,
              supply, ATH, and % moves.
            </p>
          </div>
          <Link href={cgUrl} target="_blank" rel="noreferrer" className="bk-link shrink-0" style={{ fontSize: "0.75rem" }}>
            Open on CoinGecko ↗
          </Link>
        </div>
        <p className="bk-text-muted mt-2" style={{ fontSize: "0.6875rem" }}>
          Fetched <span className="font-mono">{formatDatetime(row.fetched_at, localePrefs)}</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono">id: {row.coingecko_id}</span>
        </p>
        {metricsStatGrid(row, localePrefs)}
      </CardBody>
    </Card>
  );
}

/** Same layout as a real snapshot, but no DB row yet — makes clear which fields will appear after sync. */
export function AssetCoingeckoMetricsNoSnapshot({
  assetCode,
  resolvedCoingeckoId,
  localePrefs,
}: {
  assetCode: string;
  resolvedCoingeckoId: string | null;
  localePrefs: UserLocalePreferences;
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
    <Card className="bk-card_dashed">
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="bk-form-label" style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              CoinGecko (USD)
            </h2>
            <p className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
              No live CoinGecko data on <span className="font-mono font-medium">{assetCode}</span> yet. Run{" "}
              <strong>Asset fundamentals (USD)</strong> from Sync runs — then the same row in{" "}
              <code className="bk-code">assets</code> is filled (no duplicate history rows).
            </p>
          </div>
          <Link href="/dashboard/sync-runs" className="bk-link shrink-0" style={{ fontSize: "0.75rem" }}>
            Sync runs →
          </Link>
        </div>
        <p className="bk-text-muted mt-2" style={{ fontSize: "0.6875rem" }}>
          Catalog id: <span className="font-mono">{resolvedCoingeckoId ?? "not resolved"}</span>
          {!resolvedCoingeckoId ? (
            <span className="ml-1 opacity-80">
              — the worker resolves ids via search (max per run). Run sync again if you just added the asset.
            </span>
          ) : null}
        </p>
        <div className="opacity-90">{metricsStatGrid(dashRow, localePrefs)}</div>
      </CardBody>
    </Card>
  );
}

export function AssetCoingeckoMetricsPlaceholder({ reason }: { reason: "non_crypto" | "no_data" }) {
  const copy =
    reason === "non_crypto"
      ? "CoinGecko live fields are only collected for crypto assets in the catalog."
      : "No live CoinGecko data yet. Use Sync runs (worker or local ENABLE_LOCAL_COINGECKO_METRICS_SYNC).";

  return (
    <Card className="bk-card_dashed">
      <CardBody>
        <h2 className="bk-form-label" style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
          CoinGecko (USD)
        </h2>
        <p className="bk-text-muted" style={{ fontSize: "0.75rem" }}>
          {copy}
        </p>
      </CardBody>
    </Card>
  );
}
