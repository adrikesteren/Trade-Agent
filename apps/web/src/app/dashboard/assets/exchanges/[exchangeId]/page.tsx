import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ exchangeId: string }> };

export default async function ExchangeDetailPage({ params }: PageProps) {
  const { exchangeId } = await params;
  const supabase = await createClient();

  const { data: ex, error } = await supabase
    .from("exchanges")
    .select("id, code, name, metadata, created_at")
    .eq("id", exchangeId)
    .maybeSingle();

  if (error || !ex) {
    notFound();
  }

  const { data: markets, count } = await supabase
    .from("markets")
    .select("id, market_symbol, quote_code, status", { count: "exact" })
    .eq("exchange_id", exchangeId)
    .order("market_symbol", { ascending: true })
    .limit(150);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1">
      <nav className="text-xs text-zinc-500">
        <Link href="/dashboard/assets" className="underline-offset-2 hover:underline">
          Markets & assets
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Exchange</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{ex.name}</h1>
        <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">{ex.code}</p>
        <p className="mt-1 text-xs text-zinc-500">id: {ex.id}</p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Markets {typeof count === "number" ? `(showing ${markets?.length ?? 0} of ${count})` : ""}
        </h2>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {(markets ?? []).map((m) => (
            <li key={m.id} className="py-2">
              <Link
                href={`/dashboard/assets/markets/${m.id}`}
                className="font-mono text-sm font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
              >
                {m.market_symbol}
              </Link>
              <span className="ml-2 text-xs text-zinc-500">
                {m.quote_code} · {m.status}
              </span>
            </li>
          ))}
          {!markets?.length ? (
            <li className="py-4 text-sm text-zinc-500">No markets synced for this exchange yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
