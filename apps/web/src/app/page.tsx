import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-20">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Trade Agent
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Paper-first trading automation: signal agents propose, the mediator enforces risk, workers
          execute. Stack: Next.js, Supabase, Upstash Redis & QStash, Bitvavo (EUR).
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {user ? (
          <Link
            href="/dashboard"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Open dashboard
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}
