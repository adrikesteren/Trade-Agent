import { AppHeaderActions } from "@/components/app-header-actions";
import { AppSchemaNav, type TabInfo } from "@/components/app-schema-nav";
import { AppShellAppSwitcher } from "@/components/app-shell-app-switcher";
import { listDashboardAppSwitchOptions } from "@/config/app-shell";
import { getDashboardActiveApp } from "@/lib/shell/get-dashboard-active-app";
import { getDashboardSession } from "@/lib/supabase/dashboard-session";
import { AppHeader, AppMain, AppShell } from "@repo/adricore/blocks";
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

  const { appId, app } = await getDashboardActiveApp();
  const appSwitchOptions = listDashboardAppSwitchOptions();

  const tabInfos: TabInfo[] = app.tabs.map(tab => ({
    slug: tab.getApiName(),
    label: tab.getLabel(),
    href: tab.getHref(),
    target: tab.getTarget(),
    section: tab.section,
    order: tab.order,
  }));

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <AppShell className="min-h-0 flex-1 overflow-hidden">
        <AppHeader
          brand={
            <Link href="/overview" className="bk-app-header_brand">
              Trade Agent
            </Link>
          }
          nav={
            <div className="flex flex-wrap items-center gap-3">
              <AppShellAppSwitcher options={appSwitchOptions} currentId={appId} />
              <AppSchemaNav tabs={tabInfos} />
            </div>
          }
          actions={<AppHeaderActions />}
        />
        <AppMain>{children}</AppMain>
      </AppShell>
    </div>
  );
}
