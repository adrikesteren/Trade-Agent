"use client";

import { createClient } from "@/lib/supabase/client";
import { Alert, Button, FormElement, Input, PageHeader, Stack } from "@repo/blocks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";

function RegisterForm() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/overview";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "info">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (password !== confirm) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setStatus("error");
      setMessage("Password must be at least 6 characters.");
      return;
    }
    setStatus("loading");
    const supabase = createClient();
    const origin = window.location.origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }
    setStatus("info");
    setMessage("Account created. Confirm your email if required, then sign in.");
  }

  return (
    <div className="bk-container flex min-h-[60vh] w-full flex-col justify-center px-6">
      <PageHeader title="Create account" subtitle="Email and password. You can sign in on the next page if confirmation is required." />
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
              autoComplete="new-password"
            />
          </FormElement>
          <FormElement id={confirmId} label="Confirm password" required>
            <Input
              id={confirmId}
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </FormElement>
          <Button type="submit" variant="brand" loading={status === "loading"}>
            {status === "loading" ? "Creating…" : "Create account"}
          </Button>
        </Stack>
      </form>
      {message ? (
        <Alert tone={status === "error" ? "error" : "info"} className="mt-4">
          {message}
        </Alert>
      ) : null}
      <p className="bk-text-muted mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="bk-link">
          Sign in
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

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="bk-container w-full px-6 py-16 text-center bk-text-muted">Loading…</div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
