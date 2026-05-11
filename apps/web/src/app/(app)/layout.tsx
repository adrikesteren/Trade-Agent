import { AppHeaderActions } from "@/components/app-header-actions";
import { AppSchemaNav } from "@/components/app-schema-nav";
import { getDashboardSession } from "@/lib/supabase/dashboard-session";
import { AppHeader, AppMain, AppShell } from "@repo/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getDashboardSession();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <AppShell className="min-h-0 flex-1 overflow-hidden">
        <AppHeader
          brand={
            <Link href="/overview" className="bk-app-header_brand">
              Trade Agent
            </Link>
          }
          nav={<AppSchemaNav />}
          actions={<AppHeaderActions />}
        />
        <AppMain>{children}</AppMain>
      </AppShell>
    </div>
  );
}
