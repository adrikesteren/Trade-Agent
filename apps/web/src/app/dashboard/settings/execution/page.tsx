import { redirect } from "next/navigation";

export default function LegacySettingsExecutionRedirect() {
  redirect("/dashboard/me/preferences/execution");
}
