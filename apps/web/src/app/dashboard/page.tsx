import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, label, mode, exchange, api_key_configured, allowlisted_symbols")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: true });

  const primaryId = connectors?.[0]?.id;

  const { data: signals } = await supabase
    .from("signals")
    .select("id, agent_id, action, confidence, symbol, created_at, reasons")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(15);

  const { data: decisions } = await supabase
    .from("trade_decisions")
    .select("id, approved, reason_codes, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(15);

  const { data: risk } = primaryId
    ? await supabase
        .from("risk_state")
        .select(
          "equity_eur, open_position_count, daily_pnl_eur, kill_switch, exposure_by_symbol",
        )
        .eq("user_id", user!.id)
        .eq("connector_id", primaryId)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Read-only overview of signals and mediator decisions. Execution stays on workers (QStash).{" "}
          <Link
            href="/dashboard/assets"
            className="font-medium text-zinc-800 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
          >
            Browse markets & assets
          </Link>
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Connectors</h2>
        <p className="mt-1 text-xs text-zinc-500">
          API keys stay out of the database in v1; use env or a vault later. Toggle only reflects whether you configured keys server-side.
        </p>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {(connectors ?? []).map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <div className="font-medium text-zinc-800 dark:text-zinc-200">
                {c.label ?? "Unnamed"} · {c.exchange} · {c.mode}
              </div>
              <div className="mt-1 font-mono text-xs text-zinc-500">id: {c.id}</div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                API key (server env): {c.api_key_configured ? "flag on" : "not configured"} · Symbols:{" "}
                {(c.allowlisted_symbols as string[])?.length
                  ? (c.allowlisted_symbols as string[]).join(", ")
                  : "none listed"}
              </div>
            </li>
          ))}
          {!connectors?.length ? (
            <li className="py-3 text-sm text-zinc-500">No connectors yet.</li>
          ) : null}
        </ul>
      </section>

      {risk ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Risk snapshot</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">Equity (EUR, model)</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">{String(risk.equity_eur)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Open positions</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {String(risk.open_position_count)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Daily PnL</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">{String(risk.daily_pnl_eur)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Kill switch</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {risk.kill_switch ? "on" : "off"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent signals</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Agent</th>
                <th className="py-2 pr-2">Symbol</th>
                <th className="py-2 pr-2">Action</th>
                <th className="py-2 pr-2">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {(signals ?? []).map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                    {new Date(s.created_at as string).toISOString()}
                  </td>
                  <td className="py-2 pr-2">{s.agent_id}</td>
                  <td className="py-2 pr-2">{s.symbol ?? "—"}</td>
                  <td className="py-2 pr-2">{s.action}</td>
                  <td className="py-2 pr-2">{s.confidence ?? "—"}</td>
                </tr>
              ))}
              {!signals?.length ? (
                <tr>
                  <td colSpan={5} className="py-4 text-zinc-500">
                    No signals yet. Run a QStash job to `/api/workers/ingest` with your `userId` and
                    `connectorId`.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Mediator decisions</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Approved</th>
                <th className="py-2 pr-2">Reasons</th>
              </tr>
            </thead>
            <tbody>
              {(decisions ?? []).map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-2 font-mono text-zinc-600 dark:text-zinc-400">
                    {new Date(d.created_at as string).toISOString()}
                  </td>
                  <td className="py-2 pr-2">{d.approved ? "yes" : "no"}</td>
                  <td className="py-2 pr-2">{(d.reason_codes as string[])?.join(", ") || "—"}</td>
                </tr>
              ))}
              {!decisions?.length ? (
                <tr>
                  <td colSpan={3} className="py-4 text-zinc-500">
                    No decisions yet.
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
