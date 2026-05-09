"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ExecutionModeValue = "paper" | "live";

export async function updateExecutionMode(formData: FormData): Promise<void> {
  const raw = formData.get("execution_mode");
  if (raw !== "paper" && raw !== "live") {
    throw new Error("Invalid execution mode");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.schema("trading").from("user_execution_preferences").upsert(
    {
      user_id: user.id,
      execution_mode: raw,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/settings/execution");
}
