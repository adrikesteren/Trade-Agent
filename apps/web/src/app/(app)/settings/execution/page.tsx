import { redirect } from "next/navigation";

export default function LegacySettingsExecutionRedirect() {
  redirect("/me/preferences/execution");
}
