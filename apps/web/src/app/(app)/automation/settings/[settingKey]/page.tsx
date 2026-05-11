import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ settingKey: string }> };

/** @deprecated Use `/system-settings/[key]`. */
export default async function LegacyAutomationSettingDetailRedirect({ params }: PageProps) {
  const { settingKey } = await params;
  redirect(`/system-settings/${encodeURIComponent(settingKey)}`);
}
