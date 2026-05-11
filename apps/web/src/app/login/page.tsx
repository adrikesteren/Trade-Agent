"use client";

import { createClient } from "@/lib/supabase/client";
import { Alert, Button, FormElement, Input, PageHeader, Stack } from "@repo/blocks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/overview";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="bk-container flex min-h-[60vh] w-full flex-col justify-center px-6">
      <PageHeader title="Sign in" subtitle="Email and password (Supabase Auth)." />
      <form onSubmit={onSubmit} className="mt-8">
        <Stack gap="md">
          <FormElement id={emailId} label="Email" required>
            <Input
              id={emailId}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </FormElement>
          <FormElement id={passwordId} label="Password" required>
            <Input
              id={passwordId}
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </FormElement>
          <Button type="submit" variant="brand" loading={status === "loading"}>
            {status === "loading" ? "Signing in…" : "Sign in"}
          </Button>
        </Stack>
      </form>
      {message ? (
        <Alert tone="error" className="mt-4">
          {message}
        </Alert>
      ) : null}
      <p className="bk-text-muted mt-6 text-center text-sm">
        No account yet?{" "}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="bk-link">
          Create account
        </Link>
      </p>
      <p className="bk-text-muted mt-4 text-center text-sm">
        <Link href="/" className="bk-link">
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
        <div className="bk-container w-full px-6 py-16 text-center bk-text-muted">Loading…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
