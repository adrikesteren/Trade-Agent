import { DashboardSchemaNav } from "@/components/dashboard-schema-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { AppHeader, AppMain, AppShell } from "@repo/blocks";
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

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <AppShell className="min-h-0 flex-1 overflow-hidden">
        <AppHeader
          brand={
            <Link href="/dashboard" className="bk-app-header_brand">
              Trade Agent
            </Link>
          }
          nav={<DashboardSchemaNav />}
          actions={<SignOutButton />}
        />
        <AppMain>{children}</AppMain>
      </AppShell>
    </div>
  );
}
