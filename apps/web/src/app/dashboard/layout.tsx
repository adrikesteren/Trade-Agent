import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let { data: connectors } = await supabase
    .from("connectors")
    .select("id, label, mode, exchange")
    .eq("user_id", user.id);

  if (!connectors?.length) {
    const { data: created } = await supabase
      .from("connectors")
      .insert({
        user_id: user.id,
        label: "Primary",
        exchange: "bitvavo",
        mode: "paper",
      })
      .select("id, label, mode, exchange")
      .single();
    connectors = created ? [created] : [];
  }

  const primary = connectors[0];
  if (primary) {
    const { data: rs } = await supabase
      .from("risk_state")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_id", primary.id)
      .maybeSingle();
    if (!rs) {
      await supabase.from("risk_state").insert({
        user_id: user.id,
        connector_id: primary.id,
      });
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Trade Agent
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link
              href="/dashboard"
              className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/assets"
              className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Markets
            </Link>
          </nav>
          <span className="hidden text-xs text-zinc-500 sm:inline">Paper · Bitvavo</span>
        </div>
        <SignOutButton />
      </header>
      <div className="flex-1 bg-zinc-50 px-4 py-6 dark:bg-zinc-900">{children}</div>
    </div>
  );
}
