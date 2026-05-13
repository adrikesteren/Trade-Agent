import { OverviewRetrieveBitvavoAssetsButton } from "@/app/(app)/overview/overview-retrieve-bitvavo-assets-button";
import { OverviewRetrieveBitvavoMarketsButton } from "@/app/(app)/overview/overview-retrieve-bitvavo-markets-button";
import { OverviewSyncCoingeckoCoinIdsButton } from "@/app/(app)/overview/overview-sync-coingecko-coin-ids-button";
import { OverviewSyncCoingeckoMetricsButton } from "@/app/(app)/overview/overview-sync-coingecko-metrics-button";
import { Card, CardBody, ListViewLayout, PageHeader, Stack } from "@repo/adricore/blocks";
import Link from "next/link";

export default async function OverviewPage() {
  return (
    <ListViewLayout>
      <div className="bk-container bk-container_lg">
        <Stack gap="lg">
          <PageHeader
            title="Overview"
            subtitle="Start from market data: sync listings and candles, then inspect assets and fundamentals. Trading signals, mediator, and execution layers are not wired in this repo yet."
          />

          <Card>
            <CardBody>
              <h2 className="bk-form-label" style={{ marginBottom: "0.75rem" }}>
                Where to go
              </h2>
              <ul className="bk-stack bk-stack_gap-sm list-inside list-disc bk-text-muted" style={{ margin: 0 }}>
                <li>
                  <Link href="/markets" className="bk-link">
                    Markets
                  </Link>{" "}
                  — tradable pairs (catalog)
                </li>
                <li>
                  <Link href="/assets" className="bk-link">
                    Assets
                  </Link>{" "}
                  — base instruments
                </li>
                <li>
                  <Link href="/exchanges" className="bk-link">
                    Exchanges
                  </Link>
                </li>
                <li>
                  <Link href="/sync-runs" className="bk-link">
                    Sync runs
                  </Link>{" "}
                  — Bitvavo + CoinGecko jobs
                </li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="bk-form-label" style={{ marginBottom: "0.75rem" }}>
                Bitvavo catalog
              </h2>
              <p className="bk-text-muted bk-stack bk-stack_gap-sm text-sm" style={{ marginBottom: "0.75rem" }}>
                Pull all symbols from Bitvavo <code className="bk-code">GET /v2/assets</code> and upsert{" "}
                <code className="bk-code">catalog.assets</code> with display names and deposit/withdrawal metadata.
                Markets sync uses <code className="bk-code">GET /v2/markets</code> and only upserts pairs whose base
                matches an existing <code className="bk-code">catalog.assets.code</code> (no new assets).
              </p>
              <div className="flex flex-wrap gap-3">
                <OverviewRetrieveBitvavoAssetsButton />
                <OverviewRetrieveBitvavoMarketsButton />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="bk-form-label" style={{ marginBottom: "0.75rem" }}>
                CoinGecko
              </h2>
              <p className="bk-text-muted bk-stack bk-stack_gap-sm text-sm" style={{ marginBottom: "0.75rem" }}>
                For crypto assets missing <code className="bk-code">coingecko_coin_id</code>: copy from{" "}
                <code className="bk-code">metadata.coingecko_id</code> when set, then match remaining symbols via
                CoinGecko <code className="bk-code">/search</code> (rate-limited). Same run as{" "}
                <code className="bk-code">POST /api/markets/coingecko/coin-id-sync?source=manual</code> and{" "}
                <code className="bk-code">sync_runs</code> job <code className="bk-code">coingecko_asset_coin_id</code>.
              </p>
              <p className="bk-text-muted bk-stack bk-stack_gap-sm text-sm" style={{ marginBottom: "0.75rem" }}>
                Live USD snapshot (market cap, volume, price, etc.) on assets that already have a coin id — resolve phase
                then CoinGecko <code className="bk-code">/coins/markets</code>. Same as{" "}
                <code className="bk-code">POST /api/markets/coingecko/metrics-sync?source=manual</code> and{" "}
                <code className="bk-code">sync_runs</code> job <code className="bk-code">coingecko_assets_usd_live</code>.
              </p>
              <div className="flex flex-wrap gap-3">
                <OverviewSyncCoingeckoCoinIdsButton />
                <OverviewSyncCoingeckoMetricsButton />
              </div>
            </CardBody>
          </Card>
        </Stack>
      </div>
    </ListViewLayout>
  );
}
