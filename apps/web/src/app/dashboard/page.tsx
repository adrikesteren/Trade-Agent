import Link from "next/link";

export default async function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Start from market data: sync listings and candles, then inspect assets and fundamentals. Trading signals,
          mediator, and execution layers are not wired in this repo yet.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Where to go</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            <Link href="/dashboard/markets" className="font-medium underline-offset-2 hover:underline">
              Markets
            </Link>{" "}
            — tradable pairs (catalog)
          </li>
          <li>
            <Link href="/dashboard/assets" className="font-medium underline-offset-2 hover:underline">
              Assets
            </Link>{" "}
            — base instruments
          </li>
          <li>
            <Link href="/dashboard/exchanges" className="font-medium underline-offset-2 hover:underline">
              Exchanges
            </Link>
          </li>
          <li>
            <Link href="/dashboard/sync-runs" className="font-medium underline-offset-2 hover:underline">
              Sync runs
            </Link>{" "}
            — Bitvavo + CoinGecko jobs
          </li>
        </ul>
      </section>
    </div>
  );
}
