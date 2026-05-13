import {
  buildAssetCoingeckoMetricsRow,
  type AssetCoingeckoMetricsRow,
  type AssetLiveCoingeckoDb,
} from "@/components/asset-coingecko-metrics-block";
import { formatDecimal, formatPercentSigned, formatUsdAmount, formatUsdSigned } from "@/lib/locale/format";
import type { UserLocalePreferences } from "@/lib/locale/types";
import { Output } from "@repo/adricore/blocks";
import Link from "next/link";

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

function rowOutputs(row: AssetCoingeckoMetricsRow, prefs: UserLocalePreferences, formatDt: (v: string | number | Date) => string) {
  const cgHref =
    row.coingecko_id && row.coingecko_id !== "—"
      ? `https://www.coingecko.com/en/coins/${encodeURIComponent(row.coingecko_id)}`
      : null;

  return (
    <>
      <Output label="CoinGecko coin id" type="text" value={row.coingecko_id} span="full" />
      <Output label="CoinGecko fetched at" type="datetime" value={row.fetched_at} formatDatetime={formatDt} />
      <Output label="Price (USD)" type="text" value={formatUsdAmount(row.price_usd, prefs, { compactAbove: 1_000_000 })} />
      <Output label="24h Δ (USD)" type="text" value={formatUsdSigned(row.price_change_24h_usd, prefs)} />
      <Output label="Market cap (USD)" type="text" value={formatUsdAmount(row.market_cap_usd, prefs, { compactAbove: 1_000_000 })} />
      <Output label="24h volume (USD)" type="text" value={formatUsdAmount(row.total_volume_usd, prefs, { compactAbove: 1_000_000 })} />
      <Output label="FDV (USD)" type="text" value={formatUsdAmount(row.fully_diluted_valuation_usd, prefs, { compactAbove: 1_000_000 })} />
      <Output
        label="24h high / low (USD)"
        type="text"
        value={`${formatUsdAmount(row.high_24h_usd, prefs)} / ${formatUsdAmount(row.low_24h_usd, prefs)}`}
        span="full"
      />
      <Output
        label="24h % / 7d %"
        type="text"
        value={`${formatPercentSigned(row.price_change_24h_pct, prefs)} / ${formatPercentSigned(row.price_change_7d_pct, prefs)}`}
        span="full"
      />
      <Output label="Rank (mcap)" type="text" value={fmtInt(prefs, row.market_cap_rank)} />
      <Output
        label="Circ. / total / max supply"
        type="text"
        value={`${fmtSupply(prefs, row.circulating_supply)} · ${fmtSupply(prefs, row.total_supply)} · ${fmtSupply(prefs, row.max_supply)}`}
        span="full"
      />
      <Output
        label="ATH (USD) / vs ATH"
        type="text"
        value={`${formatUsdAmount(row.ath_usd, prefs)} · ${formatPercentSigned(row.ath_change_pct, prefs)}`}
        span="full"
      />
      {cgHref ? (
        <Output
          label="CoinGecko"
          type="text"
          value={
            <Link href={cgHref} target="_blank" rel="noopener noreferrer" className="bk-link">
              Open on CoinGecko ↗
            </Link>
          }
          span="full"
        />
      ) : null}
    </>
  );
}

function emptySnapshotOutputs(coinIdDisplay: string) {
  const dash = "—";
  return (
    <>
      <Output label="CoinGecko coin id" type="text" value={coinIdDisplay} span="full" />
      <Output label="CoinGecko fetched at" type="text" value={dash} />
      <Output label="Price (USD)" type="text" value={dash} />
      <Output label="24h Δ (USD)" type="text" value={dash} />
      <Output label="Market cap (USD)" type="text" value={dash} />
      <Output label="24h volume (USD)" type="text" value={dash} />
      <Output label="FDV (USD)" type="text" value={dash} />
      <Output label="24h high / low (USD)" type="text" value={dash} span="full" />
      <Output label="24h % / 7d %" type="text" value={dash} span="full" />
      <Output label="Rank (mcap)" type="text" value={dash} />
      <Output label="Circ. / total / max supply" type="text" value={dash} span="full" />
      <Output label="ATH (USD) / vs ATH" type="text" value={dash} span="full" />
      <Output
        label="CoinGecko metrics"
        type="text"
        value={
          <span className="bk-text-muted">
            No snapshot yet. Run{" "}
            <strong className="text-inherit">Asset fundamentals (USD)</strong> from{" "}
            <Link href="/sync-runs" className="bk-link">
              Sync runs
            </Link>
            .
          </span>
        }
        span="full"
      />
    </>
  );
}

/** CoinGecko columns as plain `Output` rows inside `RecordPageGrid` (crypto only). */
export function AssetCoingeckoDetailOutputs({
  asset,
  metadataCoingeckoId,
  localePrefs,
  formatDt,
}: {
  asset: AssetLiveCoingeckoDb;
  metadataCoingeckoId: string | null;
  localePrefs: UserLocalePreferences;
  formatDt: (v: string | number | Date) => string;
}) {
  const row = buildAssetCoingeckoMetricsRow(asset, metadataCoingeckoId);
  const coinIdDisplay = asset.coingecko_coin_id?.trim() || metadataCoingeckoId?.trim() || "—";

  if (row) {
    return rowOutputs(row, localePrefs, formatDt);
  }
  return emptySnapshotOutputs(coinIdDisplay);
}
