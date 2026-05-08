"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage(null);
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
    setMessage("Check your email for the sign-in link.");
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We email you a one-time link (Supabase Auth). No password stored in this app.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {status === "sending" ? "Sending…" : "Email me a link"}
        </button>
      </form>
      {message ? (
        <p
          className={`mt-4 text-sm ${status === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          {message}
        </p>
      ) : null}
      <p className="mt-8 text-center text-sm text-zinc-500">
        <Link href="/" className="underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200">
          Back home
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-zinc-500">Loading…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
