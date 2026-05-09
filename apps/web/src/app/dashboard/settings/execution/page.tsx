import { redirect } from "next/navigation";

export default function ExecutionSettingsRedirectPage() {
  redirect("/dashboard/executors");
}
