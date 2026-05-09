import { createClient } from "@/lib/supabase/server";

export default async function SignalJobsPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .schema("automation")
    .from("signal_jobs")
    .select("id, job_key, market_id, timeframe, close_time, status, error, created_at, started_at, ended_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Signal Jobs</h1>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p> : null}
      <pre className="overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        {JSON.stringify(rows ?? [], null, 2)}
      </pre>
    </div>
  );
}
