import { redirect } from "next/navigation";

export default function LegacyDashboardSettingsRedirect() {
  redirect("/dashboard/me/preferences");
}
