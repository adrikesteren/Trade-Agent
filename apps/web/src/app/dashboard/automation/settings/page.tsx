import { redirect } from "next/navigation";

/** @deprecated Use `/dashboard/system-settings`. */
export default function LegacyAutomationSettingsListRedirect() {
  redirect("/dashboard/system-settings");
}
