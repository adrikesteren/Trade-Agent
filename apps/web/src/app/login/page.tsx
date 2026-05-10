"use client";

import { createClient } from "@/lib/supabase/client";
import { Alert, Button, FormElement, Input, PageHeader, Stack } from "@repo/blocks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";

function LoginForm() {
  const emailId = useId();
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
    <div className="bk-container flex min-h-[60vh] w-full flex-col justify-center px-6">
      <PageHeader
        title="Sign in"
        subtitle="We email you a one-time link (Supabase Auth). No password stored in this app."
      />
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
          <Button type="submit" variant="brand" loading={status === "sending"}>
            {status === "sending" ? "Sending…" : "Email me a link"}
          </Button>
        </Stack>
      </form>
      {message ? (
        <Alert tone={status === "error" ? "error" : "info"} className="mt-4">
          {message}
        </Alert>
      ) : null}
      <p className="bk-text-muted mt-8 text-center">
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
