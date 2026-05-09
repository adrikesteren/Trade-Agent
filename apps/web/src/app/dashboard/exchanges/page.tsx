import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ExchangesIndexPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .order("code", { ascending: true })
    .limit(500);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Exchanges</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Venues that host <Link href="/dashboard/markets" className="underline-offset-2 hover:underline">markets</Link>{" "}
            (catalog reference data).
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
          All exchanges {rows ? `(${rows.length})` : ""}
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Code</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-medium">
                    <Link
                      href={`/dashboard/exchanges/${r.id}`}
                      className="text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                    >
                      {r.name?.trim() ? r.name : r.code}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-mono text-zinc-700 dark:text-zinc-300">{r.code}</td>
                </tr>
              ))}
              {!rows?.length ? (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-zinc-500">
                    No exchanges in the database yet.
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
