import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ assetId: string }> };

export default async function AssetDetailPage({ params }: PageProps) {
  const { assetId } = await params;
  const supabase = await createClient();

  const { data: asset, error } = await supabase
    .from("assets")
    .select("id, code, kind, name, metadata, created_at")
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1">
      <nav className="text-xs text-zinc-500">
        <Link href="/dashboard/assets" className="underline-offset-2 hover:underline">
          Markets & assets
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Asset</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {asset.name ?? asset.code}{" "}
          <span className="font-mono text-lg text-zinc-500">({asset.code})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Kind: <span className="font-medium">{asset.kind}</span> · id:{" "}
          <span className="font-mono text-xs">{asset.id}</span>
        </p>
      </div>

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
                  href={`/dashboard/assets/markets/${m.id}`}
                  className="font-mono font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                >
                  {m.market_symbol}
                </Link>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  {ex?.id ? (
                    <Link
                      href={`/dashboard/assets/exchanges/${ex.id}`}
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
