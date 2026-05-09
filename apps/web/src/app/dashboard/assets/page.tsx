import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type AssetRow = {
  id: string;
  code: string;
  kind: string;
  name: string | null;
  created_at: string | null;
};

export default async function AssetsIndexPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, name, created_at")
    .limit(2000);

  const assets = (rows ?? []) as AssetRow[];
  const assetIds = assets.map((a) => a.id);

  const mcapByAsset = new Map<string, number>();
  if (assetIds.length > 0) {
    const { data: mcapRows, error: mcapErr } = await supabase.rpc("latest_market_cap_by_assets", {
      _asset_ids: assetIds,
    });
    if (!mcapErr && mcapRows) {
      for (const r of mcapRows as { asset_id: string; market_cap_usd: number | string | null }[]) {
        if (r.asset_id == null || r.market_cap_usd == null) continue;
        const n = typeof r.market_cap_usd === "number" ? r.market_cap_usd : Number(r.market_cap_usd);
        if (Number.isFinite(n)) mcapByAsset.set(r.asset_id, n);
      }
    }
  }

  const sortedRows = [...assets].sort((a, b) => {
    const na = mcapByAsset.get(a.id) ?? Number.NEGATIVE_INFINITY;
    const nb = mcapByAsset.get(b.id) ?? Number.NEGATIVE_INFINITY;
    if (nb !== na) return nb - na;
    return (a.code ?? "").localeCompare(b.code ?? "", undefined, { sensitivity: "base" });
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Assets</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Base instruments (crypto, later stocks). Pairs live under{" "}
            <Link href="/dashboard/markets" className="underline-offset-2 hover:underline">
              Markets
            </Link>
            .
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          Back to dashboard
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          All assets{" "}
          {sortedRows.length ? `(${sortedRows.length} shown, max 2000, by market cap ↓)` : ""}
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">id</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-mono font-medium">
                    <Link
                      href={`/dashboard/assets/${r.id}`}
                      className="text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                    >
                      {r.code}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{r.name ?? "—"}</td>
                  <td className="py-2 pr-3">{r.kind}</td>
                  <td className="py-2 pr-3 font-mono text-zinc-600 dark:text-zinc-400">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[10px] text-zinc-500">{r.id}</td>
                </tr>
              ))}
              {!sortedRows.length ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    No assets yet.
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
