import { BitvavoSyncStatusPanel } from "@/components/bitvavo-sync-status-panel";
import {
  BITVAVO_SYNC_JOB_CANDLES_EUR,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  type BitvavoSyncJobStatus,
} from "@/lib/markets/record-bitvavo-sync-status";
import { getCandlesSyncIntervalMs, getMarketsSyncIntervalMs } from "@/lib/markets/sync-schedule";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type SyncRunRow = {
  id: string;
  job_key: string;
  status: string;
  trigger_source: string | null;
  created_at: string | null;
  completed_at: string | null;
  ended_at: string | null;
};

function lastCompletedAtForJob(rows: SyncRunRow[], jobKey: string): string | null {
  for (const r of rows) {
    if (r.job_key === jobKey && r.status === "completed" && r.completed_at) return r.completed_at;
  }
  return null;
}

export default async function AssetsPage() {
  const supabase = await createClient();

  const { data: runRows, error: runsError } = await supabase
    .from("bitvavo_sync_runs")
    .select("id, job_key, status, trigger_source, created_at, completed_at, ended_at")
    .in("job_key", [BITVAVO_SYNC_JOB_MARKETS_EUR, BITVAVO_SYNC_JOB_CANDLES_EUR])
    .order("created_at", { ascending: false })
    .limit(120);

  const runsSafe = (runsError ? [] : (runRows ?? [])) as SyncRunRow[];
  const latestByJob = new Map<string, SyncRunRow>();
  for (const row of runsSafe) {
    if (!latestByJob.has(row.job_key)) latestByJob.set(row.job_key, row);
  }
  const marketsLatest = latestByJob.get(BITVAVO_SYNC_JOB_MARKETS_EUR) ?? null;
  const candlesLatest = latestByJob.get(BITVAVO_SYNC_JOB_CANDLES_EUR) ?? null;

  const marketsStatus = (marketsLatest?.status as BitvavoSyncJobStatus | null) ?? null;
  const candlesStatus = (candlesLatest?.status as BitvavoSyncJobStatus | null) ?? null;
  const marketsCreatedAt = marketsLatest?.created_at ?? null;
  const candlesCreatedAt = candlesLatest?.created_at ?? null;
  const marketsCompletedAt = lastCompletedAtForJob(runsSafe, BITVAVO_SYNC_JOB_MARKETS_EUR);
  const candlesCompletedAt = lastCompletedAtForJob(runsSafe, BITVAVO_SYNC_JOB_CANDLES_EUR);

  const recentRuns = runsSafe.slice(0, 30);

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
          database (idempotent upserts). <strong>Market listings are not auto-synced</strong> — use{" "}
          <strong>Sync Now</strong> when you need an update. Candle OHLCV can still run on a schedule (worker / local
          dev settings); retention follows your catalog settings.
        </p>
        <div className="mt-4">
          <BitvavoSyncStatusPanel
            marketsStatus={marketsStatus}
            marketsCreatedAt={marketsCreatedAt}
            marketsCompletedAt={marketsCompletedAt}
            candlesStatus={candlesStatus}
            candlesCreatedAt={candlesCreatedAt}
            candlesCompletedAt={candlesCompletedAt}
            marketsIntervalMs={getMarketsSyncIntervalMs()}
            candlesIntervalMs={getCandlesSyncIntervalMs()}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent Bitvavo sync runs</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Append-only history: each sync attempt is one row (running → completed or failed). Latest attempt per job is
          reflected in the cards above; this table shows recent attempts including failures.
        </p>
        {runsError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{runsError.message}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-2">Job</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Trigger</th>
                  <th className="py-2 pr-2">Started</th>
                  <th className="py-2 pr-2">Ended</th>
                  <th className="py-2 pr-2">Completed (success)</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2 font-mono text-zinc-800 dark:text-zinc-200">
                      {r.job_key.replace(/^bitvavo_/, "")}
                    </td>
                    <td className="py-1.5 pr-2">{r.status}</td>
                    <td className="py-1.5 pr-2">{r.trigger_source ?? "—"}</td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.ended_at
                        ? new Date(r.ended_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {r.completed_at
                        ? new Date(r.completed_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                  </tr>
                ))}
                {!recentRuns.length ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      No runs yet. Run a sync from the cards above.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
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
