import { redirect } from "next/navigation";

export default function LegacyDashboardSettingsRedirect() {
  redirect("/me/preferences");
}
