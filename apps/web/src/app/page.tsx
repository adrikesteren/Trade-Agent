import { createClient } from "@/lib/supabase/server";
import { Button, Stack } from "@repo/blocks";
import Link from "next/link";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="bk-container w-full px-4 py-20">
      <Stack gap="lg">
        <div>
          <h1 className="bk-page-header_title" style={{ fontSize: "1.875rem" }}>
            Trade Agent
          </h1>
          <p className="bk-lead">
            Paper-first trading automation: signal agents propose, the mediator enforces risk, workers execute. Stack:
            Next.js, Supabase, Upstash Redis & QStash, Bitvavo (EUR).
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {user ? (
            <Button variant="brand" asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button variant="brand" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
              <Button variant="neutral" asChild>
                <Link href="/register">Create account</Link>
              </Button>
            </div>
          )}
        </div>
      </Stack>
    </main>
  );
}
