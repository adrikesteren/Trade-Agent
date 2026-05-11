import { Card, CardBody, ListViewLayout, PageHeader, Stack } from "@repo/blocks";
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
        </Stack>
      </div>
    </ListViewLayout>
  );
}
