import { createClient } from "@/lib/supabase/server";

export default async function SignalRunsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("automation")
    .from("signal_runs")
    .select("id, signal_job_id, agent_id, signal_id, status, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Signal Runs</h1>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p> : null}
      <pre className="overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        {JSON.stringify(rows ?? [], null, 2)}
      </pre>
    </div>
  );
}
