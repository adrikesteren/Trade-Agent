import { redirect } from "next/navigation";

/** @deprecated Use `/system-settings`. */
export default function LegacyAutomationSettingsListRedirect() {
  redirect("/system-settings");
}
