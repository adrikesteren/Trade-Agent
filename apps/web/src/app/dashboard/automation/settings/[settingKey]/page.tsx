import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ settingKey: string }> };

/** @deprecated Use `/dashboard/system-settings/[key]`. */
export default async function LegacyAutomationSettingDetailRedirect({ params }: PageProps) {
  const { settingKey } = await params;
  redirect(`/dashboard/system-settings/${encodeURIComponent(settingKey)}`);
}
